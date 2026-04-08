import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-name',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { submissionId, prompt } = await req.json()
    
    if (!submissionId && !prompt) {
       throw new Error('Missing submissionId or prompt');
    }

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
        const text = openaiData?.choices?.[0]?.message?.content || '';
        
        // Map OpenAI response to Gemini format for frontend compatibility
        return {
          candidates: [
            {
              content: {
                parts: [{ text: text }]
              }
            }
          ]
        };
      }
      
      throw new Error('All AI providers failed or were unavailable.');
    };

    // If a prompt is provided, we act as a secure proxy for the grading request
    if (prompt) {
      const data = await callAiWithFallback(prompt);
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Fetch submission and its questions
    const { data: submission, error: subError } = await supabase
      .from('submissions')
      .select('*, exams(*)')
      .eq('id', submissionId)
      .single()

    if (subError) throw subError
    if (submission.is_manual) {
      return new Response(JSON.stringify({ message: 'Skipping AI grading: manual marks already present.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: questions, error: qError } = await supabase
      .from('questions')
      .select('*')
      .eq('exam_id', submission.exam_id)

    if (qError) throw qError

    let totalScore = 0
    const studentAnswers = submission.answers || {}
    const markingDetails: Record<string, any> = {}
    const structuredToGrade: any[] = []

    // 1. Instant Grade MCQs and Collect Structured
    for (const question of questions) {
      const studentAnswer = (studentAnswers[question.id] || '').toString().trim();

      if (question.type === 'mcq') {
        const isCorrect = studentAnswer.toUpperCase() === (question.correct_answer || '').toString().toUpperCase()
        const awarded = isCorrect ? question.marks : 0
        totalScore += awarded
        markingDetails[question.id] = {
          awarded_marks: awarded,
          feedback: isCorrect ? 'Correct' : `Incorrect. Correct answer: ${question.correct_answer}`
        }
      } else if (question.type === 'structured') {
        if (!studentAnswer) {
          markingDetails[question.id] = { awarded_marks: 0, feedback: 'No answer provided' }
          continue
        }
        structuredToGrade.push({
          id: question.id,
          question: question.question_text,
          model_answer: question.correct_answer,
          student_answer: studentAnswer,
          max_marks: question.marks
        });
      }
    }

    // 2. Batched Grade Structured Questions
    if (structuredToGrade.length > 0) {
      const batchPrompt = `
        You are a Master Academic Examiner for the examination: "${submission.exams.title}".
        Your task is to mark the following structured question submissions from a student.
        
        INPUT DATA (JSON ARRAY):
        ${JSON.stringify(structuredToGrade, null, 2)}

        MARKING RUBRIC & CONSTRAINTS:
        1. ACCURACY: Compare the [student_answer] strictly against the [model_answer].
        2. NO SKIPPING: You must evaluate every single Question ID provided in the INPUT DATA. If a key is missing from your response, the student will incorrectly receive 0.
        3. SCORING: Award [awarded_marks] between 0 and [max_marks]. Use 0.5 increments if necessary.
        4. FEEDBACK: Provide concise, professional feedback speaking DIRECTLY to the student in the second person (e.g., "You explained the concept well..." or "Your code is missing...").
        
        OUTPUT FORMAT (STRICT JSON ONLY):
        Return ONLY a raw JSON object where the keys are the Question IDs. Do not include markdown formatting.
        Example:
        {
          "uuid-1": { "awarded_marks": 5, "feedback": "Well explained..." },
          "uuid-2": { "awarded_marks": 2, "feedback": "Partially correct..." }
        }
      `;

      try {
        const result = await callAiWithFallback(batchPrompt)
        const content = result.candidates[0].content.parts[0].text
        
        // Robust JSON extraction
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        let batchedGrading: Record<string, any> = {};
        
        try {
          batchedGrading = JSON.parse(jsonMatch ? jsonMatch[0] : content);
        } catch (parseErr) {
          console.error("Primary JSON parse failed, attempting cleanup:", parseErr);
          // Fallback cleanup for common AI formatting issues
          const cleaned = content.replace(/```json|```/g, '').trim();
          batchedGrading = JSON.parse(cleaned);
        }

        // Merge batched results into markingDetails
        structuredToGrade.forEach(q => {
          const grading = batchedGrading[q.id];
          if (grading) {
            const awarded = Math.min(grading.awarded_marks || 0, q.max_marks);
            totalScore += awarded;
            markingDetails[q.id] = {
              awarded_marks: awarded,
              feedback: grading.feedback || 'Marked'
            };
          } else {
            // Safety fallback if AI skips a key
            console.warn(`AI skipped question ID: ${q.id}. Defaulting to 0.`);
            markingDetails[q.id] = { awarded_marks: 0, feedback: 'Question was skipped by AI evaluator.' };
          }
        });
      } catch (aiErr) {
        console.error('Batched AI marking failed:', aiErr);
        throw new Error('Automated marking failed. Please try again or mark manually.');
      }
    }

    // Update submission with final score and details
    const { error: updateError } = await supabase
      .from('submissions')
      .update({
        score: totalScore,
        graded: true,
        marking_details: markingDetails
      })
      .eq('id', submissionId)
      .eq('is_manual', false)

    if (updateError) throw updateError

    return new Response(JSON.stringify({ 
      success: true, 
      score: totalScore,
      marking_details: markingDetails 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const err = error as Error;
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

