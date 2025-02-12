# Gmail Grouping Extension

This Chrome extension automatically organizes your Gmail inbox by intelligently grouping emails into predefined categories using OpenAI's GPT and the Gmail API.

## ✨ Features

AI-Powered Labeling: Uses OpenAI's API to categorize emails into predefined labels.

Smart Filtering: Prevents infinite label creation by selecting only from a structured label set.

Label Management: Includes a function to delete all non-system labels.

Secure API Handling: Uses environment variables (.env) to keep API keys private.

## 🚀 Setup

Clone the repo

`git clone https://github.com/yourusername/gmail-grouping-extension.git
cd gmail-grouping-extension`

Then run `npm install`

Create a .env file and add your API keys:

`OPENAI_API_KEY=your_openai_key
GMAIL_CLIENT_ID=your_gmail_client_id`

Load the extension in Chrome

Go to [chrome://extensions/]chrome://extensions/

Enable "Developer Mode"

Click "Load Unpacked" and select the extension folder.

## 🛠 Tech Stack

JavaScript (ES6+)

Gmail API

OpenAI GPT API

Chrome Extension Manifest v3
