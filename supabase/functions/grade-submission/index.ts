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
    const geminiApiKey = 'AIzaSyDPQ4zPw3srzdCkDYPH7NCrJgjLCv0gvaE';

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

    for (const question of questions) {
      const studentAnswer = studentAnswers[question.id] || ''

      if (question.type === 'mcq') {
        const isCorrect = studentAnswer.toUpperCase() === question.correct_answer.toUpperCase()
        const awarded = isCorrect ? question.marks : 0
        totalScore += awarded
        markingDetails[question.id] = {
          awarded_marks: awarded,
          feedback: isCorrect ? 'Correct' : `Incorrect. Correct answer: ${question.correct_answer}`
        }
      } else if (question.type === 'structured') {
        if (!studentAnswer.trim()) {
          markingDetails[question.id] = { awarded_marks: 0, feedback: 'No answer provided' }
          continue
        }

        // Use Gemini to grade structured questions
        const gradingPrompt = `
          Grade the student's answer against the model answer.
          Question: ${question.question_text}
          Model Answer: ${question.correct_answer}
          Student Answer: ${studentAnswer}
          Maximum Marks: ${question.marks}

          Return ONLY a JSON object: { "awarded_marks": number, "feedback": "string" }
        `

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${geminiApiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: gradingPrompt }]
            }]
          }),
        })

        const result = await response.json()
        const content = result.candidates[0].content.parts[0].text
        const jsonMatch = content.match(/\{.*\}/s)
        const grading = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content)

        const awarded = Math.min(grading.awarded_marks, question.marks)
        totalScore += awarded
        markingDetails[question.id] = {
          awarded_marks: awarded,
          feedback: grading.feedback
        }
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
