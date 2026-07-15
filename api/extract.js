const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};
