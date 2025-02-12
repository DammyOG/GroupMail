import dotenv from "dotenv";
dotenv.config();

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;

export const GMAIL_SCOPES = process.env.GMAIL_SCOPES.split(",");
