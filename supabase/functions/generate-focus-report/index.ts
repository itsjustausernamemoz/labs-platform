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
    const { submissionId } = await req.json()
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    
    if (!geminiApiKey && !openaiApiKey) {
      throw new Error('No AI API keys configured.');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Fetch data
    const { data: submission, error: subError } = await supabase
      .from('submissions')
      .select('*, exams(title), students(student_number)')
      .eq('id', submissionId)
      .single()

    if (subError) throw subError

    const { data: questions, error: qError } = await supabase
      .from('questions')
      .select('*')
      .eq('exam_id', submission.exam_id)

    if (qError) throw qError

    // 2. Prepare analysis context
    const studentPerformance = questions.map(q => {
      const detail = submission.marking_details?.[q.id] || { awarded_marks: 0, feedback: 'Not marked' };
      return {
        question: q.question_text,
        max_marks: q.marks,
        awarded_marks: detail.awarded_marks,
        feedback: detail.feedback,
        student_answer: submission.answers?.[q.id] || 'No answer'
      };
    });

    const prompt = `
      You are an expert Personal Academic Coach and Study Strategist. 
      Analyze the following student performance for the exam: "${submission.exams.title}".
      Provide a "High-Impact Student Focus Report" designed to help the student master the material.

      STUDENT PERFORMANCE SUMMARY:
      - Score: ${submission.score} / ${submission.total_marks}
      - Student ID: ${submission.students.student_number}

      DETAILED DATA:
      ${JSON.stringify(studentPerformance, null, 2)}

      TASKS:
      1. PEDAGOGICAL SWOT:
         - STRENGTHS: Specific concepts mastered.
         - WEAKNESSES: Clear conceptual or technical gaps.
         - OPPORTUNITIES: Potential for rapid improvement in specific areas.
         - THREATS: Foundational concepts missing that risk future failure.
      2. RECOMMENDED STUDY TECHNIQUES: Based on the TYPE of errors (e.g., miscalculation vs. lack of knowledge), suggest 2-3 specific study methods (e.g., Active Recall, Feynman Technique, Blurting).
      3. PERSONAL RECOVERY PLAN: A 14-day step-by-step plan for the student to fix their weaknesses.
      4. TOPICS TO MASTER: 3-5 high-priority topics with "Why" (reason for failure) and "How" (how to study this specifically).
      5. COACH'S ENCOURAGEMENT: A brief, motivating summary.

      RETURN ONLY A JSON OBJECT with this structure:
      {
        "swot": {
          "strengths": ["string"],
          "weaknesses": ["string"],
          "opportunities": ["string"],
          "threats": ["string"]
        },
        "study_techniques": [
          { "method": "string", "description": "string" }
        ],
        "recovery_plan": [
          { "day_range": "string", "task": "string" }
        ],
        "focus_topics": [
          { "topic": "string", "reason": "string", "recommendation": "string" }
        ],
        "overall_summary": "string"
      }
    `;

    const callAiWithFallback = async (promptText: string) => {
      // Try Gemini first
      if (geminiApiKey) {
        try {
          const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptText }] }],
              generationConfig: { temperature: 0.2 }
            })
          });

          if (geminiRes.ok) {
            const data = await geminiRes.json();
            return data.candidates[0].content.parts[0].text;
          }
        } catch (e) {
          console.error('Gemini failed, trying OpenAI:', e);
        }
      }

      // Fallback to OpenAI
      if (openaiApiKey) {
        const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: promptText }],
            temperature: 0.2
          })
        });

        if (openaiRes.ok) {
          const data = await openaiRes.json();
          return data.choices[0].message.content;
        }
      }

      throw new Error('AI analysis failed.');
    };

    const aiResponse = await callAiWithFallback(prompt);
    
    // Clean JSON if needed
    const jsonMatch = aiResponse.match(/\{.*\}/s);
    const reportData = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(aiResponse);

    return new Response(JSON.stringify(reportData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
