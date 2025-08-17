// api/send.js
import run from "../index.js";

export default async function handler(req, res) {
    try {
        await run();
        res.status(200).send("Mensagem enviada com sucesso.");
    } catch (err) {
        console.error("Erro na execução do script:", err);
        res.status(500).send("Erro na execução: " + err.message);
    }
}
