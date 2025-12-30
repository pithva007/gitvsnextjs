import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { geminiService } from '@/lib/services/geminiService'
import { repositoryService } from '@/lib/services/repositoryService'

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request)
    const body = await request.json()
    const { repositoryId, question, conversationHistory } = body

    if (!repositoryId || !question) {
      return NextResponse.json(
        { error: 'Repository ID and question are required' },
        { status: 400 }
      )
    }

    const repository = await repositoryService.getRepository(repositoryId, user.userId)

    if (!repository) {
      return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
    }

    const context = {
      files: repository.files.slice(0, 20).map((f: { path: string }) => f.path),
      recentCommits: repository.commits
        .slice(0, 5)
        .map((c: { shortHash: string; message: string }) => `${c.shortHash}: ${c.message}`),
      contributors: repository.contributors.map((c: { name: string }) => c.name),
    }

    const response = await geminiService.chatAboutRepository({
      repositoryId,
      question,
      conversationHistory,
      context,
    })

    return NextResponse.json({ response, question })
  } catch (error: any) {
    console.error('AI chat error:', error)
    return NextResponse.json(
      { error: 'Failed to process chat', details: error.message },
      { status: 500 }
    )
  }
}
