# VS Code LM API Bridge

**Prototype your AI ideas instantly, without the OpenAI bill.**

> [!IMPORTANT]
> This is an **OpenAI API Simulator**, not the actual OpenAI service. It is designed solely for **verification and prototyping** of AI workflows using your local VS Code models.

---

## 💡 Why use this?
Validate your LangChain workflows, or AI Agent for "free" by leveraging your existing **GitHub Copilot** subscription. Perfect for testing ideas before you commit to a commercial API subscription.

## ⚡ Quick Start
1. **Launch**: Open the sidebar panel, select a model, and click **Start Server**.
2. **Connect**: Update your app's configuration:
   - **Base URL**: `http://127.0.0.1:9090/v1`
   - **API Key**: `sk-test` (anything works)
   - **Model**: The ID shown in the bridge (e.g., `copilot-gpt-4o`)

## 🐍 Python Example
```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:9090/v1", api_key="sk-test")

# Uses your local VS Code model!
response = client.chat.completions.create(
    model="copilot-gpt-4o", 
    messages=[{"role": "user", "content": "Hello!"}]
)
```

---
## Note:
*This is a prototype and may not be suitable for production use.*. 
*Requires GitHub Copilot Chat extension and Copilot enabled.*. 
*The model selected will actually work, not the one in the request.*. 