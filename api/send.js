import fetch from "node-fetch";
import { DateTime } from "luxon";

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

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
        const errorText = await res.text();
        console.error("Erro ao enviar mensagem para o Slack:", errorText);
        throw new Error(`Erro no Slack: ${res.status} - ${errorText}`);
    }

    return res;
}

export default async function handler(req, res) {
    try {
        console.log('=== Iniciando execução ===');

        // Verifica variáveis de ambiente
        if (!NOTION_API_KEY || !NOTION_DATABASE_ID || !SLACK_WEBHOOK_URL) {
            const missing = [];
            if (!NOTION_API_KEY) missing.push('NOTION_API_KEY');
            if (!NOTION_DATABASE_ID) missing.push('NOTION_DATABASE_ID');
            if (!SLACK_WEBHOOK_URL) missing.push('SLACK_WEBHOOK_URL');

            console.error('Variáveis de ambiente faltando:', missing);
            return res.status(500).json({
                error: 'Variáveis de ambiente não configuradas',
                missing
            });
        }

        const now = DateTime.now().setZone("America/Sao_Paulo");
        const startOfDay = now.startOf("day").toISO();
        const endOfDay = now.endOf("day").toISO();
        const todayDate = now.toISODate();

        console.log(`Data/hora atual: ${now.toISO()}`);
        console.log(`Data de hoje: ${todayDate}`);

        // Definimos o período: manhã se hora < 15, senão noite
        // Ajustei para 15h para pegar melhor os horários da action
        const period = now.hour < 15 ? "morning" : "evening";
        console.log(`Período detectado: ${period}`);

        // Busca as tarefas para hoje (não concluídas)
        console.log('Buscando tarefas para hoje...');
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

        console.log(`Encontradas ${todayTasks.length} tarefas para hoje`);

        // Busca as tarefas alteradas hoje
        console.log('Buscando tarefas alteradas hoje...');
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

        console.log(`Encontradas ${changedTasks.length} tarefas alteradas hoje`);

        // Formata as mensagens
        const morningMessage = formatTasks(
            todayTasks,
            "☀️ Bom dia! Estas são as tarefas para hoje:"
        );

        const eveningMessage = formatTasks(
            changedTasks,
            "🌙 Resumo do dia – tarefas alteradas:"
        );

        const message = period === "morning" ? morningMessage : eveningMessage;

        console.log(`Enviando mensagem para o período: ${period}`);
        console.log('Mensagem:', message);

        // Envia para o Slack
        await sendToSlack(message);

        console.log('✅ Mensagem enviada com sucesso!');

        res.status(200).json({
            success: true,
            message: "Mensagem enviada com sucesso",
            period,
            todayTasksCount: todayTasks.length,
            changedTasksCount: changedTasks.length,
            timestamp: now.toISO()
        });

    } catch (error) {
        console.error('❌ Erro na execução:', error);
        res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
}