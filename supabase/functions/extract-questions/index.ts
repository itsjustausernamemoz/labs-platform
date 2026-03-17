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
    const geminiApiKey = 'AIzaSyDPQ4zPw3srzdCkDYPH7NCrJgjLCv0gvaE';

    if (!geminiApiKey) {
      throw new Error('Missing GEMINI_API_KEY')
    }

    const prompt = `
      You are an expert examiner. Extract questions from the following text and return them as a JSON array.
      
      CRITICAL INSTRUCTIONS:
      1. Classify each question as either "mcq" or "structured".
      2. For MCQ, provide "options" as an array of strings (e.g., ["A. ...", "B. ..."]) and "correct_answer" as the letter (e.g., "A").
      3. For structured, provide a "correct_answer" as a comprehensive model answer.
      4. DETECT MARKS: Look for patterns like "Marks: [X]", "(X)", "[X]", or "X marks". If no marks are explicitly stated, assign a reasonable value (e.g., 2 for mcq, 5-10 for structured).
      5. Return ONLY the JSON array. Do not include markdown formatting like \`\`\`json.

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

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      }),
    })

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Gemini API error:', errorData);
      throw new Error(`Gemini API error: ${response.statusText}`);
    }

    const result = await response.json()
    console.log('Gemini response received');
    const content = result.candidates[0].content.parts[0].text

    // Attempt to extract JSON if Gemini adds conversational filler
    const jsonMatch = content.match(/\[\s*\{.*\}\s*\]/s)
    if (!jsonMatch) {
      console.error('Failed to find JSON array in Gemini response:', content);
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
