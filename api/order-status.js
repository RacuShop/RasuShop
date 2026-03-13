/**
 * Vercel serverless function: Order status endpoint
 * Returns the current order status for a Telegram user
 * Searches WEEEK CRM tasks by Telegram ID
 *
 * Environment variable required: WEEEK_API_TOKEN
 */

export default async function handler(req, res) {
    // Only accept GET requests
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { telegramId } = req.query;

        // Validate required fields
        if (!telegramId) {
            return res.status(400).json({ error: 'Missing telegramId parameter' });
        }

        // Validate WEEEK API token
        if (!process.env.WEEEK_API_TOKEN) {
            console.error('WEEEK_API_TOKEN is not set in environment variables');
            return res.status(500).json({
                error: 'Server configuration error',
                message: 'WEEEK API token not configured',
            });
        }

        console.log('Searching for orders for Telegram ID:', telegramId);

        // Call WEEEK API to get tasks
        // Get tasks from project 2 (where orders are created)
        const weeekResponse = await fetch(`https://api.weeek.net/public/v1/tm/tasks?projectId=2`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${process.env.WEEEK_API_TOKEN}`,
                'Content-Type': 'application/json',
            },
        });

        let responseData;
        try {
            const text = await weeekResponse.text();
            responseData = text ? JSON.parse(text) : {};
        } catch (e) {
            console.error('Failed to parse WEEEK response:', e);
            responseData = { error: 'Invalid JSON response from WEEEK' };
        }

        console.log('WEEEK response status:', weeekResponse.status);
        console.log('WEEEK response data keys:', Object.keys(responseData));

        // Handle authentication errors
        if (weeekResponse.status === 401) {
            console.error('WEEEK authentication failed - invalid token');
            return res.status(401).json({
                error: 'Authentication failed',
                message: 'WEEEK API token is invalid or expired',
            });
        }

        if (!weeekResponse.ok) {
            console.error('WEEEK API error:', {
                status: weeekResponse.status,
                statusText: weeekResponse.statusText,
                data: responseData,
            });

            return res.status(weeekResponse.status).json({
                error: 'Failed to fetch tasks from WEEEK CRM',
                details: responseData,
            });
        }

        // WEEEK API returns data in different formats
        // Try different possible structures
        let tasks = [];
        if (responseData.data && Array.isArray(responseData.data)) {
            tasks = responseData.data;
        } else if (Array.isArray(responseData)) {
            tasks = responseData;
        } else if (responseData.tasks && Array.isArray(responseData.tasks)) {
            tasks = responseData.tasks;
        }

        console.log('Found tasks:', tasks.length);

        // Search for tasks that contain the Telegram ID in description
        const userTasks = tasks.filter(task => {
            const description = task.description || '';
            return description.includes(`Telegram ID: ${telegramId}`);
        });

        console.log('User tasks found:', userTasks.length);

        if (userTasks.length === 0) {
            return res.status(200).json({
                hasOrder: false,
            });
        }

        // Sort tasks by ID (newest first)
        const sortedTasks = userTasks.sort((a, b) => (b.id || 0) - (a.id || 0));
        const latestTask = sortedTasks[0];

        console.log("LATEST TASK:", JSON.stringify(latestTask, null, 2));
        // Extract status from the task
        // In WEEEK, status might be in different fields
        let status = 'Неизвестен';

        if (latestTask.column && latestTask.column.title) {
        status = latestTask.column.title;
        } else if (latestTask.columnName) {
        status = latestTask.columnName;
        } else if (latestTask.statusName) {
        status = latestTask.statusName;
        }

        console.log('Order status found:', status, 'for task:', latestTask.id);

        return res.status(200).json({
            hasOrder: true,
            status: status,
            taskId: latestTask.id,
        });

    } catch (error) {
        console.error('Order status error:', {
            message: error.message,
            stack: error.stack,
            type: error.constructor.name,
        });
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message,
        });
    }
}