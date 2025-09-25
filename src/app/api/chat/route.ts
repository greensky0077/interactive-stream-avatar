// import { NextResponse } from "next/server"
// import { generateText } from "ai"

// import { registry } from "@/lib/provider-registry"

// export async function POST(request: Request, { params }) {
//   const { providerModel, prompt } = await request.json()

//   if (!providerModel || !prompt) {
//     return NextResponse.error()
//   }

//   try {
//     const result = await generateText({
//       model: registry.languageModel(providerModel),
//       prompt: "give a very short answer for this: " + prompt,
//     })

//     if (!result) {
//       throw new Error(`Failed to fetch: ${result}`)
//     }

//     return NextResponse.json({ data: result.text })
//   } catch (error: any) {
//     console.error(error)
//     return NextResponse.json({ error: error.message })
//   }
// }

import { openai } from "@ai-sdk/openai"
import { anthropic } from "@ai-sdk/anthropic"
import { mistral } from "@ai-sdk/mistral"
import { streamText } from "ai"

// Allow streaming responses up to 30 seconds
export const maxDuration = 30

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

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

    try {
      const result = await streamText({
        // Use a widely available model
        model: openai("gpt-4o-mini"),
        messages,
      })

      return result.toDataStreamResponse()
    } catch (openaiError: any) {
      console.error("OpenAI API error:", openaiError)
      
      // Check if it's a geographic restriction error
      if (openaiError.message?.includes("Country, region, or territory not supported") || 
          openaiError.message?.includes("unsupported_country_region_territory")) {

        // Try provider fallback if available (Mistral -> Anthropic)
        try {
          if (process.env.MISTRAL_API_KEY) {
            const result = await streamText({
              model: mistral("mistral-large-latest"),
              messages,
            })
            return result.toDataStreamResponse()
          }
        } catch (mistralErr) {
          console.error("Mistral fallback error:", mistralErr)
        }

        try {
          if (process.env.ANTHROPIC_API_KEY) {
            const result = await streamText({
              model: anthropic("claude-3-sonnet-20240229"),
              messages,
            })
            return result.toDataStreamResponse()
          }
        } catch (anthropicErr) {
          console.error("Anthropic fallback error:", anthropicErr)
        }

        // Return a minimal SSE stream so useChat piping doesn't fail
        const assistantText =
          "OpenAI is not available in your region and no fallback provider is configured. " +
          "Configure ANTHROPIC_API_KEY or MISTRAL_API_KEY in .env, or use a VPN."

        const lines = [
          // Announce a text delta token
          `event: message`,
          `data: ${JSON.stringify({ type: "text-delta", delta: assistantText })}`,
          "",
          // Finalize the response
          `event: done`,
          `data: {}`,
          "",
        ]
        return new Response(lines.join("\n"), {
          status: 200,
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        })
      }
      
      // For other OpenAI errors, return the original error
      throw openaiError
    }
  } catch (error: any) {
    console.error("Chat API error:", error)
    return Response.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
