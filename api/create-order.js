/**
 * Vercel serverless function: Order creation endpoint
 * Receives cart, survey, and user data from frontend
 * Creates a task in WEEEK CRM
 * 
 * Environment variable required: WEEEK_API_TOKEN
 */

export default async function handler(req, res) {
    // Only accept POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { telegramId, name, username, cartItems, survey, totalPrice } = req.body;

        // Validate required fields
        if (!telegramId || !name || !cartItems || !survey) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Build readable cart items text
        const cartItemsText = cartItems
            .map(item => `• ${item.title} — ${item.price} ₽`)
            .join('\n');

        // Build readable survey answers text
        const surveyText = Object.entries(survey)
            .filter(([question, answer]) => answer !== null && answer !== undefined && answer !== '')
            .map(([question, answer]) => `• ${question}: ${answer}`)
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

        // Add timestamp for WEEEK task
        const now = new Date().toISOString();

        // Call WEEEK API to create task
        const weeekResponse = await fetch('https://api.weeek.net/public/v1/tm/tasks', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.WEEEK_API_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title: `Новый заказ — ${name}`,
                description: description,
                boardId: 2,
                projectId: 2,
                dueDate: now,
            }),
        });

        if (!weeekResponse.ok) {
            const errorData = await weeekResponse.json().catch(() => ({}));
            console.error('WEEEK API error:', errorData);
            return res.status(weeekResponse.status).json({
                error: 'Failed to create task in WEEEK CRM',
                details: errorData,
            });
        }

        const weeekData = await weeekResponse.json();

        return res.status(200).json({
            success: true,
            taskId: weeekData?.id,
            message: 'Order created successfully',
        });

    } catch (error) {
        console.error('Order creation error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message,
        });
    }
}
