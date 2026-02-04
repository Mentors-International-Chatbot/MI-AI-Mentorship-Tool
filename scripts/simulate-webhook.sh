#!/bin/bash

BASE_URL="http://localhost:3000/api/webhook/meta"
VERIFY_TOKEN="test-token" # Needs to match env var if set, or we might need to mock it looking at the code
PHONE="573001234567"

echo "1. Testing Verification (GET)..."
# The code checks process.env.META_VERIFY_TOKEN
# We might need to assume a value or set it when running the server.
curl -s -X GET "$BASE_URL?hub.mode=subscribe&hub.verify_token=$VERIFY_TOKEN&hub.challenge=12345"
echo -e "\n"

echo "2. Sending 'Hola' (New User)..."
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "'"$PHONE"'",
          "text": { "body": "Hola" }
        }]
      }
    }]
  }]
}'
echo -e "\n"

sleep 1

echo "3. Sending 'ACEPTO' (Consent)..."
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "'"$PHONE"'",
          "text": { "body": "ACEPTO" }
        }]
      }
    }]
  }]
}'
echo -e "\n"

sleep 1

echo "4. Sending Name 'Maria'..."
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "'"$PHONE"'",
          "text": { "body": "Maria" }
        }]
      }
    }]
  }]
}'
echo -e "\n"
