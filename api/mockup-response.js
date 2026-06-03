/**
 * Vercel serverless function: Mockup response endpoint
 * Creates a subtask under the client's order task in Weeek
 * with the client's approval status and optional revision comment.
 *
 * Environment variable required: WEEEK_API_TOKEN
 */

export default async function handler(req, res) {

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { taskId, telegramId, status, comment, mockupName } = req.body;

        if (!taskId || !telegramId || !status) {
            return res.status(400).json({ error: 'Missing required fields: taskId, telegramId, status' });
        }

        if (!process.env.WEEEK_API_TOKEN) {
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const fileName = mockupName || 'макет';

        let title, description;

        if (status === 'approved') {
            title = `✅ Согласован: ${fileName}`;
            description = `Клиент согласовал макет.`;
        } else if (status === 'revision') {
            const revisionText = comment?.trim() || 'Без комментария';
            title = `🔄 Правки: ${fileName}`;
            description = `Клиент запросил правки:\n\n${revisionText}`;
        } else {
            return res.status(400).json({ error: 'Invalid status. Use "approved" or "revision"' });
        }

        // Create a child task without adding it to a board as a separate card.
        const weeekResponse = await fetch('https://api.weeek.net/public/v1/tm/tasks', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.WEEEK_API_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title,
                description,
                parentId: Number(taskId),
                locations: [],
            }),
        });

        let responseData;
        try {
            const text = await weeekResponse.text();
            responseData = text ? JSON.parse(text) : {};
        } catch (e) {
            responseData = {};
        }

        if (!weeekResponse.ok) {
            console.error('Weeek subtask error:', weeekResponse.status, responseData);
            return res.status(weeekResponse.status).json({
                error: 'Failed to create subtask in Weeek',
                details: responseData,
            });
        }

        return res.status(200).json({
            success: true,
            subtaskId: responseData?.task?.id,
        });

    } catch (error) {
        console.error('mockup-response error:', error);
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}
