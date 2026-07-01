import { Router } from "express";
import { getWebhookHandler } from "../bot/client.ts";

const router = Router();

router.post("/webhook", (req, res, next) => {
  const handler = getWebhookHandler();
  handler(req, res, next);
});

export default router;
