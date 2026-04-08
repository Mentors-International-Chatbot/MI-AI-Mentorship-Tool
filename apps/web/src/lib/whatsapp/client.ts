
const GRAPH_API_TOKEN = process.env.META_API_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

if (!GRAPH_API_TOKEN || !PHONE_NUMBER_ID) {
    console.warn("Meta API Token or Phone Number ID not found in environment variables.");
}

export async function sendWhatsAppMessage(to: string, text: string) {
    if (!GRAPH_API_TOKEN || !PHONE_NUMBER_ID) {
        console.error("Missing Meta configuration, skipping message send:", text);
        return;
    }

    const url = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;

    const body = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "text",
        text: { body: text },
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GRAPH_API_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("Error sending WhatsApp message:", errorData);
            throw new Error(JSON.stringify(errorData));
        }
    } catch (error) {
        console.error("Network error sending WhatsApp message:", error);
    }
}
