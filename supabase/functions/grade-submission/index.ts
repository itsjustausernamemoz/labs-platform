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
    const { submissionId } = await req.json()
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Fetch submission and its questions
    const { data: submission, error: subError } = await supabase
      .from('submissions')
      .select('*, exams(id)')
      .eq('id', submissionId)
      .single()

    if (subError) throw subError

    const { data: questions, error: qError } = await supabase
      .from('questions')
      .select('*')
      .eq('exam_id', submission.exam_id)

    if (qError) throw qError

    let totalScore = 0
    const studentAnswers = submission.answers || {}

    for (const question of questions) {
      const studentAnswer = studentAnswers[question.id] || ''

      if (question.type === 'mcq') {
        if (studentAnswer.toUpperCase() === question.correct_answer.toUpperCase()) {
          totalScore += question.marks
        }
      } else if (question.type === 'structured') {
        if (!studentAnswer.trim()) continue

        // Use Claude to grade structured questions
        const gradingPrompt = `
          Grade the student's answer against the model answer.
          Question: ${question.question_text}
          Model Answer: ${question.correct_answer}
          Student Answer: ${studentAnswer}
          Maximum Marks: ${question.marks}

          Return ONLY a JSON object: { "awarded_marks": number, "feedback": "string" }
        `

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicApiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-3-sonnet-20240229',
            max_tokens: 1024,
            messages: [{ role: 'user', content: gradingPrompt }],
          }),
        })

        const result = await response.json()
        const content = result.content[0].text
        const jsonMatch = content.match(/\{.*\}/s)
        const grading = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content)

        totalScore += Math.min(grading.awarded_marks, question.marks)
      }
    }

    // Update submission with final score
    const { error: updateError } = await supabase
      .from('submissions')
      .update({
        score: totalScore,
        graded: true
      })
      .eq('id', submissionId)

    if (updateError) throw updateError

    return new Response(JSON.stringify({ success: true, score: totalScore }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
