import fetch from "node-fetch";
import dotenv from "dotenv";
import { DateTime } from "luxon";
import fs from "fs/promises";

dotenv.config();

// Evita execução duplicada no mesmo processo
if (global.RUNNING) process.exit(0);
global.RUNNING = true;

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const LAST_SEND_FILE = "./.last_send.json";

// Consulta tarefas no Notion
async function queryNotion(filter) {
    const res = await fetch(
        `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${NOTION_API_KEY}`,
                "Content-Type": "application/json",
                "Notion-Version": "2022-06-28",
            },
            body: JSON.stringify({ filter }),
        }
    );

    const data = await res.json();

    if (!res.ok) {
        console.error("Erro na API do Notion:", data);
        return [];
    }
    return data.results || [];
}

// Gera URL para abrir a tarefa no Notion
function getTaskUrl(task) {
    const pageId = task.id.replace(/-/g, "");
    return `https://www.notion.so/${pageId}`;
}

// Formata tarefas em texto para Slack
function formatTasks(tasks, title) {
    if (tasks.length === 0) {
        return `*${title}*\nNenhuma tarefa encontrada.`;
    }

    const lines = tasks.map((task) => {
        const name =
            task.properties?.Title?.title?.[0]?.plain_text ||
            task.properties?.Name?.title?.[0]?.plain_text ||
            "Sem título";
        const status = task.properties?.Status?.status?.name || "Sem status";
        const url = getTaskUrl(task);
        return `• *<${url}|${name}>* – ${status}`;
    });

    return `*${title}*\n${lines.join("\n")}`;
}

// Envia mensagem para Slack
async function sendToSlack(message) {
    const res = await fetch(SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message }),
    });

    if (!res.ok) {
        console.error("Erro ao enviar mensagem para o Slack:", await res.text());
    }
}

// Lê o arquivo local para saber quando enviou a última mensagem
async function readLastSend() {
    try {
        const content = await fs.readFile(LAST_SEND_FILE, "utf-8");
        return JSON.parse(content);
    } catch {
        return null; // arquivo não existe ou erro de leitura
    }
}

// Salva a última data e período de envio
async function writeLastSend(data) {
    try {
        await fs.writeFile(LAST_SEND_FILE, JSON.stringify(data), "utf-8");
    } catch (err) {
        console.error("Erro ao salvar arquivo de controle:", err);
    }
}

async function run() {
    const now = DateTime.now().setZone("America/Sao_Paulo");
    const startOfDay = now.startOf("day").toISO();
    const endOfDay = now.endOf("day").toISO();
    const todayDate = now.toISODate();

    // Definimos o período: manhã se hora < 12, senão noite
    const period = now.hour < 12 ? "morning" : "evening";

    // Verifica se já enviou mensagem hoje nesse período
    const lastSend = await readLastSend();
    if (lastSend?.date === todayDate && lastSend?.period === period) {
        console.log(
            `Mensagem para o período ${period} de ${todayDate} já foi enviada. Saindo.`
        );
        return;
    }

    // Busca as tarefas
    const todayTasks = await queryNotion({
        and: [
            {
                property: "Due Date",
                date: { equals: todayDate },
            },
            {
                property: "Status",
                status: { does_not_equal: "Concluída" },
            },
        ],
    });

    const changedTasks = await queryNotion({
        and: [
            {
                timestamp: "last_edited_time",
                last_edited_time: {
                    on_or_after: startOfDay,
                    on_or_before: endOfDay,
                },
            },
            {
                or: [
                    { property: "Status", status: { equals: "Em Progresso" } },
                    { property: "Status", status: { equals: "Concluída" } },
                ],
            },
        ],
    });

    // Formata as mensagens
    const morningMessage = formatTasks(
        todayTasks,
        "Bom dia! Estas são as tarefas para hoje:"
    );
    const eveningMessage = formatTasks(
        changedTasks,
        "Resumo do dia – alterações:"
    );

    const message = period === "morning" ? morningMessage : eveningMessage;

    console.log(
        `Hora atual: ${now.toISO()} - Enviando mensagem para o período: ${period}`
    );

    await sendToSlack(message);

    // Atualiza arquivo com info do envio
    await writeLastSend({ date: todayDate, period });

    console.log("Mensagem enviada e controle atualizado.");
}

// Permite rodar localmente
if (process.argv[1].includes("index.js")) {
    run().catch((err) => console.error("Erro na execução do script:", err));
}

// Exporta para uso em api/send.js
export default run;
