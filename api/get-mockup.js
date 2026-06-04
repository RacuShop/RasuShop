/**
 * Vercel serverless function: Get mockup endpoint
 * Finds the client's task in Weeek by Telegram ID
 * Returns the first image attachment that does not have a client response yet
 *
 * Environment variable required: WEEEK_API_TOKEN
 */

export default async function handler(req, res) {

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {

        const { telegramId } = req.query;
        const ignoredMockupIds = new Set(
            []
                .concat(req.query.ignoreMockupId || [])
                .filter(Boolean)
                .map(id => String(id))
        );

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
        const subtasks = [
            ...(Array.isArray(task.subTasks) ? task.subTasks : []),
            ...(Array.isArray(task.subtasks) ? task.subtasks : []),
            ...(Array.isArray(task.children) ? task.children : []),
            ...(Array.isArray(task.childTasks) ? task.childTasks : []),
            ...tasks.filter(item => Number(item.parentId) === Number(task.id)),
        ];
        const responseText = [
            task.description || '',
            ...subtasks
                .map(item => `${item.title || ''}\n${item.description || ''}`),
        ]
            .join('\n');

        // Filter only image attachments
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const imageAttachments = attachments.filter(att => {
            const name = (att.name || '').toLowerCase();
            return imageExtensions.some(ext => name.endsWith(ext));
        });

        const pendingImages = imageAttachments.filter(att => {
            const id = String(att.id || '');
            const name = String(att.name || '');
            const idMarker = id ? `[mockup-attachment-id:${id}]` : '';
            const nameMarker = name ? `[mockup-file:${name}]` : '';
            const oldApprovedTitle = name ? `Согласован: ${name}` : '';
            const oldRevisionTitle = name ? `Правки: ${name}` : '';
            return !(
                (id && ignoredMockupIds.has(id)) ||
                (idMarker && responseText.includes(idMarker)) ||
                (nameMarker && responseText.includes(nameMarker)) ||
                (oldApprovedTitle && responseText.includes(oldApprovedTitle)) ||
                (oldRevisionTitle && responseText.includes(oldRevisionTitle))
            );
        });

        if (pendingImages.length === 0) {
            return res.status(200).json({ hasMockup: false });
        }

        // Return the first pending image so several mockups are approved in order.
        const nextImage = pendingImages[0];

        return res.status(200).json({
            hasMockup: true,
            mockup: {
                id: nextImage.id,
                name: nextImage.name,
                url: nextImage.url,
                taskId: task.id,
                total: imageAttachments.length,
                remaining: pendingImages.length,
            },
        });

    } catch (error) {
        console.error('get-mockup error:', error);
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}
