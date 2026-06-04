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
        const { taskId, telegramId, status, comment, mockupName, mockupId } = req.body;

        if (!taskId || !telegramId || !status) {
            return res.status(400).json({ error: 'Missing required fields: taskId, telegramId, status' });
        }

        if (!process.env.WEEEK_API_TOKEN) {
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const fileName = mockupName || 'макет';
        const mockupMarkers = [
            mockupId ? `[mockup-attachment-id:${mockupId}]` : '',
            mockupName ? `[mockup-file:${mockupName}]` : '',
        ].filter(Boolean).join('\n');
        const completedMockupLine = [
            '-',
            mockupId ? `id:${mockupId}` : '',
            mockupName ? `file:${mockupName}` : '',
            `status:${status}`,
            `date:${new Date().toISOString()}`,
        ].filter(Boolean).join(' ');

        let title, description;

        if (status === 'approved') {
            title = `✅ Согласован: ${fileName}`;
            description = `Клиент согласовал макет.${mockupMarkers ? `\n\n${mockupMarkers}` : ''}`;
        } else if (status === 'revision') {
            const revisionText = comment?.trim() || 'Без комментария';
            title = `🔄 Правки: ${fileName}`;
            description = `Клиент запросил правки:\n\n${revisionText}${mockupMarkers ? `\n\n${mockupMarkers}` : ''}`;
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

        const parentTaskResponse = await fetch(`https://api.weeek.net/public/v1/tm/tasks/${taskId}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${process.env.WEEEK_API_TOKEN}`,
                'Content-Type': 'application/json',
            },
        });

        if (!parentTaskResponse.ok) {
            console.error('Weeek parent task fetch error:', parentTaskResponse.status);
            return res.status(200).json({
                success: true,
                subtaskId: responseData?.task?.id,
                registryUpdated: false,
            });
        }

        const parentTaskData = await parentTaskResponse.json();
        const parentTask = parentTaskData.task || {};
        const currentDescription = parentTask.description || '';
        let nextDescription = currentDescription;

        if (mockupMarkers && !currentDescription.includes(mockupMarkers)) {
            const registryTitle = '\n\nОбработанные макеты:\n';
            if (currentDescription.includes('Обработанные макеты:')) {
                nextDescription = `${currentDescription}\n${completedMockupLine}\n${mockupMarkers}`;
            } else {
                nextDescription = `${currentDescription}${registryTitle}${completedMockupLine}\n${mockupMarkers}`;
            }

            const updateTaskResponse = await fetch(`https://api.weeek.net/public/v1/tm/tasks/${taskId}`, {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${process.env.WEEEK_API_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: parentTask.title,
                    description: nextDescription,
                }),
            });

            if (!updateTaskResponse.ok) {
                let updateDetails = {};
                try {
                    const text = await updateTaskResponse.text();
                    updateDetails = text ? JSON.parse(text) : {};
                } catch (e) {
                    updateDetails = {};
                }
                console.error('Weeek parent task update error:', updateTaskResponse.status, updateDetails);
                return res.status(200).json({
                    success: true,
                    subtaskId: responseData?.task?.id,
                    registryUpdated: false,
                    details: updateDetails,
                });
            }
        }

        return res.status(200).json({
            success: true,
            subtaskId: responseData?.task?.id,
            registryUpdated: true,
        });

    } catch (error) {
        console.error('mockup-response error:', error);
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}
