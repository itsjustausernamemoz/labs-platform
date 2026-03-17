import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { examId, text } = await req.json()
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')

    if (!anthropicApiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY')
    }

    const prompt = `
      You are an expert examiner. Extract questions from the following text and return them as a JSON array.
      Classify each question as either "mcq" or "structured".
      For MCQ, provide "options" as an array of strings (e.g., ["A. ...", "B. ..."]) and "correct_answer" as the letter (e.g., "A").
      For structured, provide a "correct_answer" as a model answer.
      Assign reasonable "marks" to each.

      Format:
      [
        {
          "type": "mcq",
          "question_text": "...",
          "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
          "correct_answer": "B",
          "marks": 2
        },
        {
          "type": "structured",
          "question_text": "...",
          "correct_answer": "The model answer...",
          "marks": 5
        }
      ]

      Text to parse:
      ${text}
    `

    console.log(`Received request for examId: ${examId}, text length: ${text?.length}`);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 4096,
        messages: [
          { role: 'user', content: prompt }
        ],
      }),
    })

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Anthropic API error:', errorData);
      throw new Error(`Anthropic API error: ${response.statusText}`);
    }

    const result = await response.json()
    console.log('Anthropic response received');
    const content = result.content[0].text

    // Attempt to extract JSON if Claude adds conversational filler
    const jsonMatch = content.match(/\[\s*\{.*\}\s*\]/s)
    if (!jsonMatch) {
      console.error('Failed to find JSON array in Claude response:', content);
      throw new Error('Failed to extract structured questions from the AI response.');
    }
    const questions = JSON.parse(jsonMatch[0])
    console.log(`Extracted ${questions.length} questions`);

    // Store in database
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { error } = await supabase
      .from('questions')
      .insert(
        questions.map((q: any, index: number) => ({
          ...q,
          exam_id: examId,
          order_index: index
        }))
      )

    if (error) throw error

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
