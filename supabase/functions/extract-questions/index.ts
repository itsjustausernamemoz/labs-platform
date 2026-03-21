import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-name',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { examId, text } = await req.json()
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    
    if (!geminiApiKey) {
      return new Response(JSON.stringify({ 
        error: 'Missing GEMINI_API_KEY. Please set this in Supabase Dashboard > Settings > Edge Functions > Secrets.' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const callAiWithFallback = async (promptText: string) => {
      // 1. Try Gemini
      try {
        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: { temperature: 0.1 }
          })
        });

        if (geminiRes.ok) {
          console.log('Gemini call successful');
          return await geminiRes.json();
        }

        console.warn(`Gemini failed with status ${geminiRes.status}`);
        
        // If not a retryable error or no fallback key, throw
        if (![429, 500, 502, 503, 504].includes(geminiRes.status) || !openaiApiKey) {
          const errorText = await geminiRes.text();
          throw new Error(`Gemini Error (${geminiRes.status}): ${errorText}`);
        }
      } catch (err) {
        if (!openaiApiKey) throw err;
        console.error('Gemini exception, trying OpenAI fallback:', err);
      }

      // 2. Fallback to OpenAI (ChatGPT)
      if (openaiApiKey) {
        console.log('Attempting OpenAI Fallback...');
        const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'user', content: promptText }
            ],
            temperature: 0.1
          })
        });

        if (!openaiRes.ok) {
          const errorText = await openaiRes.text();
          throw new Error(`Both Gemini and OpenAI failed. OpenAI Error (${openaiRes.status}): ${errorText}`);
        }

        const openaiData = await openaiRes.json();
        const textOutput = openaiData?.choices?.[0]?.message?.content || '';
        
        // Map OpenAI response to Gemini format for compatibility
        return {
          candidates: [
            {
              content: {
                parts: [{ text: textOutput }]
              }
            }
          ]
        };
      }
      
      throw new Error('All AI providers failed or were unavailable.');
    };

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

    console.log(`Received extraction request for examId: ${examId}, text length: ${text?.length}`);

    const result = await callAiWithFallback(prompt);
    console.log('AI response received');
    const content = result.candidates[0].content.parts[0].text

    // Attempt to extract JSON if AI adds conversational filler
    const jsonMatch = content.match(/\[\s*\{.*\}\s*\]/s)
    if (!jsonMatch) {
      console.error('Failed to find JSON array in AI response:', content);
      throw new Error('Failed to extract structured questions from the AI response.');
    }
    const questionsArr = JSON.parse(jsonMatch[0])
    console.log(`Extracted ${questionsArr.length} questions`);

    // Store in database
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { error } = await supabase
      .from('questions')
      .insert(
        questionsArr.map((q: any, index: number) => ({
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
