/** Text anchor — locates a comment's position within a document. */
export interface TextAnchor {
  /** The exact text that was highlighted. */
  text: string;
  /** ~50 characters before the anchor (for disambiguation). */
  prefix: string;
  /** ~50 characters after the anchor (for disambiguation). */
  suffix: string;
}

/** A document comment (or suggestion). */
export interface DocComment {
  id: string;
  type: "comment" | "suggestion";
  anchor: TextAnchor;
  body: string;
  /** For suggestions: the replacement text. */
  replacement?: string;
  author: string;
  createdAt: string;
  resolved: boolean;
  replies: CommentReply[];
}

/** A reply to a comment. */
export interface CommentReply {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}
