/**
 * Vercel serverless function: Get mockup endpoint
 * Finds the client's task in Weeek by Telegram ID
 * Returns the latest image attachment (mockup) if present
 *
 * Environment variable required: WEEEK_API_TOKEN
 */

export default async function handler(req, res) {

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {

        const { telegramId } = req.query;

        if (!telegramId) {
            return res.status(400).json({ error: 'Missing telegramId parameter' });
        }

        if (!process.env.WEEEK_API_TOKEN) {
            return res.status(500).json({ error: 'Server configuration error' });
        }

        // Fetch all tasks for the project (same logic as order-status.js)
        const weeekResponse = await fetch(
            'https://api.weeek.net/public/v1/tm/tasks?projectId=2',
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${process.env.WEEEK_API_TOKEN}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        if (!weeekResponse.ok) {
            return res.status(weeekResponse.status).json({ error: 'Failed to fetch tasks from Weeek' });
        }

        const responseData = await weeekResponse.json();

        let tasks = [];
        if (Array.isArray(responseData.tasks)) {
            tasks = responseData.tasks;
        } else if (Array.isArray(responseData.data)) {
            tasks = responseData.data;
        }

        // Find tasks belonging to this Telegram user
        const userTasks = tasks.filter(task => {
            const description = task.description || '';
            return description.includes(`Telegram ID: ${telegramId}`);
        });

        if (userTasks.length === 0) {
            return res.status(200).json({ hasMockup: false });
        }

        // Get the latest task
        const sortedTasks = userTasks.sort((a, b) => (b.id || 0) - (a.id || 0));
        const latestTask = sortedTasks[0];

        // Fetch full task details to get attachments with fresh URLs
        const taskResponse = await fetch(
            `https://api.weeek.net/public/v1/tm/tasks/${latestTask.id}`,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${process.env.WEEEK_API_TOKEN}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        if (!taskResponse.ok) {
            return res.status(taskResponse.status).json({ error: 'Failed to fetch task details' });
        }

        const taskData = await taskResponse.json();
        const task = taskData.task;

        const attachments = task.attachments || [];

        // Filter only image attachments
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const imageAttachments = attachments.filter(att => {
            const name = (att.name || '').toLowerCase();
            return imageExtensions.some(ext => name.endsWith(ext));
        });

        if (imageAttachments.length === 0) {
            return res.status(200).json({ hasMockup: false });
        }

        // Return the latest image (last added)
        const latestImage = imageAttachments[imageAttachments.length - 1];

        return res.status(200).json({
            hasMockup: true,
            mockup: {
                id: latestImage.id,
                name: latestImage.name,
                url: latestImage.url,
                taskId: task.id,
            },
        });

    } catch (error) {
        console.error('get-mockup error:', error);
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}
