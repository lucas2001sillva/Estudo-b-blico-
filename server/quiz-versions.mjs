// A quiz can grow without changing the meaning of already saved answers.
// Old clients did not send a revision, so identify those by their original
// question count. Never guess when two revisions have the same length.
export function resolveQuizVersion(quiz, attempt) {
  if (!quiz || !attempt || !Number.isInteger(attempt.total)) return null;
  const versions = [{ revision: quiz.revision ?? 1, questions: quiz.questions }, ...(quiz.previousVersions ?? [])];
  if (attempt.quizRevision !== undefined && (!Number.isInteger(attempt.quizRevision) || attempt.quizRevision < 1)) return null;
  const matches = versions.filter(version => version.questions.length === attempt.total
    && (attempt.quizRevision === undefined || attempt.quizRevision === version.revision));
  return matches.length === 1 ? matches[0] : null;
}
