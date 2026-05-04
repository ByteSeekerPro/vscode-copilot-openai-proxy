import * as vscode from 'vscode';

export class LmBridge {
  constructor(private outputChannel?: vscode.OutputChannel) {}

  async getModels(): Promise<vscode.LanguageModelChat[]> {
    return await vscode.lm.selectChatModels();
  }

  async *streamChatCompletion(
    modelId: string,
    messages: any[],
    _options: { temperature?: number; max_tokens?: number; stream?: boolean },
    tools?: any[]
  ): AsyncIterable<string | { type: 'tool_call', data: any } | { type: 'usage', data: { prompt_tokens?: number, completion_tokens?: number, total_tokens?: number } }> {
    const models = await this.getModels();
    const model = models.find((m) => m.id === modelId) || models[0];

    this.outputChannel?.appendLine(`[Bridge] Using model: ${model?.id || 'default'}`);

    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    const vscodeMessages: vscode.LanguageModelChatMessage[] = this.mapMessages(messages);
    
    // Calculate prompt tokens
    let promptTokens = 0;
    try {
        for (const msg of vscodeMessages) {
            promptTokens += await model.countTokens(msg, new vscode.CancellationTokenSource().token);
        }
        yield { type: 'usage', data: { prompt_tokens: promptTokens } };
    } catch (error) {
        console.error('Error computing prompt tokens:', error);
    }

    const requestOptions: vscode.LanguageModelChatRequestOptions = {
        justification: 'LM API Bridge request',
    };

    // Map OpenAI tools to VS Code tools
    if (tools && tools.length > 0) {
        this.outputChannel?.appendLine(`[Bridge] Mapping ${tools.length} tools...`);
        requestOptions.tools = tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            inputSchema: t.function.parameters
        }));
    }

    const response = await model.sendRequest(vscodeMessages, requestOptions, new vscode.CancellationTokenSource().token);

    let fullText = '';
    const toolCalls: any[] = [];
    for await (const fragment of response.stream) {
        if (fragment instanceof vscode.LanguageModelTextPart) {
            fullText += fragment.value;
            yield fragment.value;
        } else if (fragment instanceof (vscode as any).LanguageModelToolCallPart) {
            const toolCallData = {
                id: (fragment as any).callId,
                type: 'function',
                function: {
                    name: (fragment as any).name,
                    arguments: JSON.stringify((fragment as any).input)
                }
            };
            toolCalls.push(toolCallData);
            yield {
                type: 'tool_call',
                data: toolCallData
            };
        }
    }

    // Calculate completion tokens (including tool calls)
    try {
        let completionText = fullText;
        for (const chunk of toolCalls) {
            // Add a string representation of the tool call to ensure it's counted
            completionText += `\nTool Call: ${chunk.function.name}(${chunk.function.arguments})`;
        }
        
        const completionTokens = await model.countTokens(completionText, new vscode.CancellationTokenSource().token);
        yield { type: 'usage', data: { 
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens, 
            total_tokens: promptTokens + completionTokens 
        } };
    } catch (error) {
        console.error('Error computing completion tokens:', error);
    }
  }

  private mapMessages(messages: any[]): vscode.LanguageModelChatMessage[] {
    const vscodeMessages: vscode.LanguageModelChatMessage[] = [];
    let systemPrompt = '';

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n' : '') + msg.content;
      } else if (msg.role === 'user') {
        let content = msg.content;
        if (systemPrompt && vscodeMessages.length === 0) {
          content = `[System Instructions]\n${systemPrompt}\n[End System Instructions]\n\n${content}`;
          systemPrompt = ''; // Only prepend to the first user message
        }
        vscodeMessages.push(vscode.LanguageModelChatMessage.User(content));
      } else if (msg.role === 'assistant') {
        vscodeMessages.push(vscode.LanguageModelChatMessage.Assistant(msg.content));
      }
    }

    return vscodeMessages;
  }
}
