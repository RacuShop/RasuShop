/**
 * Vercel serverless function: Order status endpoint
 * Returns the current order status for a Telegram user
 * Searches WEEEK CRM tasks by Telegram ID
 *
 * Environment variable required: WEEEK_API_TOKEN
 */

export default async function handler(req, res) {

    // Only allow GET
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {

        const { telegramId } = req.query;

        if (!telegramId) {
            return res.status(400).json({
                error: 'Missing telegramId parameter'
            });
        }

        if (!process.env.WEEEK_API_TOKEN) {
            console.error("WEEEK_API_TOKEN missing");
            return res.status(500).json({
                error: "Server configuration error"
            });
        }

        console.log("Searching orders for Telegram ID:", telegramId);

        // Request tasks from WEEEK
        const weeekResponse = await fetch(
            "https://api.weeek.net/public/v1/tm/tasks?projectId=2",
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${process.env.WEEEK_API_TOKEN}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!weeekResponse.ok) {
            console.error("WEEEK API error:", weeekResponse.status);
            return res.status(weeekResponse.status).json({
                error: "Failed to fetch tasks from WEEEK"
            });
        }

        const responseData = await weeekResponse.json();

        console.log("WEEEK response keys:", Object.keys(responseData));

        let tasks = [];

        if (Array.isArray(responseData.tasks)) {
            tasks = responseData.tasks;
        } else if (Array.isArray(responseData.data)) {
            tasks = responseData.data;
        }

        console.log("Total tasks received:", tasks.length);

        // Find tasks that contain Telegram ID
        const userTasks = tasks.filter(task => {
            const description = task.description || "";
            return description.includes(`Telegram ID: ${telegramId}`);
        });

        console.log("User tasks found:", userTasks.length);

        if (userTasks.length === 0) {
            return res.status(200).json({
                hasOrder: false
            });
        }

        // Sort newest first
        const sortedTasks = userTasks.sort((a, b) => (b.id || 0) - (a.id || 0));
        const latestTask = sortedTasks[0];

        console.log("LATEST TASK:", JSON.stringify(latestTask, null, 2));

        // Map WEEEK column IDs → status names
        const columnMap = {
            5: "Поступил заказ",
            6: "Разработка",
            7: "Согласование",
            8: "В производстве",
            9: "Доставка партнёром",
            10: "Готово"
        };

        const columnId = latestTask.boardColumnId;

        console.log("COLUMN ID:", columnId);

        const status = columnMap[columnId] || "Неизвестен";

        console.log("Order status:", status);

        return res.status(200).json({
            hasOrder: true,
            status: status,
            taskId: latestTask.id
        });

    } catch (error) {

        console.error("Order status error:", error);

        return res.status(500).json({
            error: "Internal server error",
            message: error.message
        });

    }

}