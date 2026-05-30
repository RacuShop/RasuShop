/**
 * Vercel serverless function: Mockup response endpoint
 * Saves the client's approval or revision request as a comment on the Weeek task
 *
 * Environment variable required: WEEEK_API_TOKEN
 */

export default async function handler(req, res) {

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {

        const { taskId, telegramId, status, comment } = req.body;

        // status: 'approved' | 'revision'
        if (!taskId || !telegramId || !status) {
            return res.status(400).json({ error: 'Missing required fields: taskId, telegramId, status' });
        }

        if (!process.env.WEEEK_API_TOKEN) {
            return res.status(500).json({ error: 'Server configuration error' });
        }

        // Build comment text
        let commentText;
        if (status === 'approved') {
            commentText = `✅ Клиент согласовал макет`;
        } else if (status === 'revision') {
            const revisionText = comment?.trim() || 'Без комментария';
            commentText = `🔄 Клиент запросил правки:\n\n${revisionText}`;
        } else {
            return res.status(400).json({ error: 'Invalid status value. Use "approved" or "revision"' });
        }

        // Post comment to Weeek task
        const weeekResponse = await fetch(
            `https://api.weeek.net/public/v1/tm/tasks/${taskId}/comments`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${process.env.WEEEK_API_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: commentText,
                }),
            }
        );

        let responseData;
        try {
            const text = await weeekResponse.text();
            responseData = text ? JSON.parse(text) : {};
        } catch (e) {
            responseData = {};
        }

        if (!weeekResponse.ok) {
            console.error('Weeek comment error:', weeekResponse.status, responseData);
            return res.status(weeekResponse.status).json({
                error: 'Failed to post comment to Weeek',
                details: responseData,
            });
        }

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('mockup-response error:', error);
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}
