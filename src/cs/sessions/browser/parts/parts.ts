export const SESSION_PART_IDS = {
	sidebar: 'sessions.parts.sidebar',
	sessions: 'sessions.parts.sessions',
	editor: 'sessions.parts.editor',
} as const;

export type SessionPartId =
	(typeof SESSION_PART_IDS)[keyof typeof SESSION_PART_IDS];
