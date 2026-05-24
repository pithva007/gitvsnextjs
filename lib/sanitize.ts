import DOMPurify from 'isomorphic-dompurify'

/**
 * Sanitizes dirty HTML strings to prevent Cross-Site Scripting (XSS) attacks.
 * It is configured to allow safe rich text formats, lists, links, and inline styling.
 */
export const sanitizeHtml = (content: string): string => {
  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'code', 'pre', 'span', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'a'
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style'],
  }) as string
}
