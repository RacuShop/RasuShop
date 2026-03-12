/**
 * Vercel serverless function: Order creation endpoint
 * Receives cart, survey, and user data from frontend
 * Creates a task in WEEEK CRM
 * 
 * Environment variable required: WEEEK_API_TOKEN
 * WEEEK API Docs: https://api.weeek.net/public/v1/tm/tasks
 */

export default async function handler(req, res) {
    // Only accept POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { telegramId, name, username, cartItems, survey, totalPrice } = req.body;

        // Validate required fields
        if (!telegramId || !name || !cartItems) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate WEEEK API token
        if (!process.env.WEEEK_API_TOKEN) {
            console.error('WEEEK_API_TOKEN is not set in environment variables');
            return res.status(500).json({
                error: 'Server configuration error',
                message: 'WEEEK API token not configured',
            });
        }

        // Build readable cart items text
        const cartItemsText = cartItems
            .map(item => `• ${item.title} — ${item.price} ₽`)
            .join('\n');

        // Build readable survey answers text
        const surveyText = Object.entries(survey || {})
            .filter(([key, value]) => value)
            .map(([key, value]) => `• ${key}: ${value}`)
            .join('\n');

        // Build order description
        const description = `Telegram ID: ${telegramId}
Имя: ${name}
Контакт: https://t.me/${username}

Состав заказа:
${cartItemsText}

Опрос:
${surveyText}

Стоимость: ${totalPrice} ₽`;

        const title = `Новый заказ — ${name}`;
        const projectId = 2;
        const boardId = 2;

        console.log('Creating WEEEK task with:', {
            title,
            projectId,
            boardId,
            descriptionLength: description.length,
        });

        // Call WEEEK API to create task
        let weeekResponse = await fetch('https://api.weeek.net/public/v1/tm/tasks', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.WEEEK_API_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title,
                description,
                projectId,
                boardId,
            }),
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
        console.log('WEEEK response data:', responseData);

        // If 401 or token error, give clear message
        if (weeekResponse.status === 401) {
            console.error('WEEEK authentication failed - invalid token');
            return res.status(401).json({
                error: 'Authentication failed',
                message: 'WEEEK API token is invalid or expired',
                details: responseData,
            });
        }

        // If 400, might be invalid field names or values
        if (weeekResponse.status === 400) {
            console.error('WEEEK validation error:', responseData);
            return res.status(400).json({
                error: 'Invalid request parameters',
                message: responseData?.message || 'WEEEK API rejected the request',
                details: responseData,
            });
        }

        // Handle other errors
        if (!weeekResponse.ok) {
            console.error('WEEEK API error:', {
                status: weeekResponse.status,
                statusText: weeekResponse.statusText,
                data: responseData,
            });

            let errorMessage = 'Failed to create task in WEEEK CRM';
            if (responseData?.error) {
                errorMessage = responseData.error;
            } else if (responseData?.message) {
                errorMessage = responseData.message;
            }

            return res.status(weeekResponse.status).json({
                error: errorMessage,
                details: responseData,
            });
        }

        // Success
        console.log('WEEEK task created successfully:', responseData);

        return res.status(200).json({
            success: true,
            taskId: responseData?.id || responseData?.data?.id,
            message: 'Order created successfully',
        });

    } catch (error) {
        console.error('Order creation error:', {
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
