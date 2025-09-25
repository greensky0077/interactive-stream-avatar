import { anthropic } from "@ai-sdk/anthropic"
import { mistral } from "@ai-sdk/mistral"
import { streamText } from "ai"

// Allow streaming responses up to 30 seconds
export const maxDuration = 30

export async function POST(req: Request) {
  try {
    const { messages, provider = "anthropic" } = await req.json()

    // Validate that messages exist and is an array
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return Response.json(
        { error: "Messages array is required and must not be empty" },
        { status: 400 }
      )
    }

    // Validate that each message has the required structure
    for (const message of messages) {
      if (!message.role || !message.content) {
        return Response.json(
          { error: "Each message must have 'role' and 'content' properties" },
          { status: 400 }
        )
      }
    }

    let model;
    
    // Select model based on provider
    switch (provider) {
      case "anthropic":
        if (!process.env.ANTHROPIC_API_KEY) {
          return Response.json(
            { error: "Anthropic API key not configured" },
            { status: 400 }
          )
        }
        model = anthropic("claude-3-sonnet-20240229")
        break;
        
      case "mistral":
        if (!process.env.MISTRAL_API_KEY) {
          return Response.json(
            { error: "Mistral API key not configured" },
            { status: 400 }
          )
        }
        model = mistral("mistral-large-latest")
        break;
        
      default:
        return Response.json(
          { error: "Unsupported provider. Use 'anthropic' or 'mistral'" },
          { status: 400 }
        )
    }

    try {
      const result = await streamText({
        model,
        messages,
      })

      return result.toDataStreamResponse()
    } catch (apiError: any) {
      console.error(`${provider} API error:`, apiError)
      
      // Check if it's a geographic restriction error
      if (apiError.message?.includes("Country, region, or territory not supported") || 
          apiError.message?.includes("unsupported_country_region_territory")) {
        
        return Response.json(
          { 
            error: `${provider} API is not available in your region. Please try another provider.`,
            code: "GEOGRAPHIC_RESTRICTION",
            suggestion: "Try using a different AI provider or use a VPN."
          },
          { status: 403 }
        )
      }
      
      // For other API errors
      return Response.json(
        { 
          error: `${provider} API error: ${apiError.message || "Unknown error"}`,
          code: "API_ERROR"
        },
        { status: 500 }
      )
    }
  } catch (error: any) {
    console.error("Alternative Chat API error:", error)
    return Response.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
