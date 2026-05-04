#!/bin/bash
PORT=9090

echo "--- Testing /v1/models ---"
curl -s http://127.0.0.1:$PORT/v1/models | jq . 2>/dev/null || curl -s http://127.0.0.1:$PORT/v1/models

# echo -e "\n\n--- Testing /v1/chat/completions (Non-Streaming) ---"
# curl -s -X POST http://127.0.0.1:$PORT/v1/chat/completions \
#   -H "Content-Type: application/json" \
#   -d '{
#     "model": "gpt-4o",
#     "messages": [{"role": "user", "content": "compare python and java in 1 line."}]
#   }' | jq . 2>/dev/null 

# echo -e "\n\n--- Testing /v1/chat/completions (Streaming) ---"
# curl -s -X POST http://127.0.0.1:$PORT/v1/chat/completions \
#   -H "Content-Type: application/json" \
#   -d '{
#     "model": "gpt-4o",
#     "messages": [{"role": "user", "content": "Write a one-line python hello world."}],
#     "stream": true
#   }'

# echo -e "\n\n--- Testing /v1/chat/completions (Tools) ---"
# curl -s -X POST http://127.0.0.1:$PORT/v1/chat/completions \
#   -H "Content-Type: application/json" \
#   -d '{
#     "model": "gpt-4o",
#     "messages": [
#       {
#         "role": "user", 
#         "content": "List the files in this project and then tell me about the `LmBridge` class. Use list_files tool and get_code_definition tool together for this."
#       }
#     ],
#     "tools": [
#       {
#         "type": "function",
#         "function": {
#           "name": "list_files",
#           "description": "List all files in the current workspace directory.",
#           "parameters": {
#             "type": "object",
#             "properties": {}
#           }
#         }
#       },
#       {
#         "type": "function",
#         "function": {
#           "name": "get_code_definition",
#           "description": "Retrieve the source code or definition for a specific class or function.",
#           "parameters": {
#             "type": "object",
#             "properties": {
#               "symbol": { "type": "string", "description": "The name of the symbol to look up" }
#             },
#             "required": ["symbol"]
#           }
#         }
#       }
#     ]
#   }' | jq . 2>/dev/null