/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from 'cs/base/common/uri';
import type {
	WritingEditorDocument,
	WritingEditorSelection,
} from 'cs/editor/common/writingEditorDocument';
import type { ArticleId } from 'cs/workbench/services/fetch/common/fetch';
import type { IChatImageAttachment } from 'cs/workbench/contrib/chat/common/chatService/chatImageAttachment';

/** Identifies the immutable payload carried by a Chat request attachment. */
export const enum ChatRequestAttachmentKind {
	Resource = 'resource',
	Text = 'text',
	Article = 'article',
	Editor = 'editor',
	Image = 'image',
}

interface IChatRequestAttachmentBase {
	readonly id: string;
	readonly name: string;
}

export interface IChatRequestResourceAttachment extends IChatRequestAttachmentBase {
	readonly kind: ChatRequestAttachmentKind.Resource;
	readonly resource: URI;
	readonly mimeType: string;
}

export interface IChatRequestTextAttachment extends IChatRequestAttachmentBase {
	readonly kind: ChatRequestAttachmentKind.Text;
	readonly content: string;
	readonly mimeType: string;
}

export interface IChatRequestArticleAttachment extends IChatRequestAttachmentBase {
	readonly kind: ChatRequestAttachmentKind.Article;
	readonly articleId: ArticleId;
}

export interface IChatRequestEditorAttachment extends IChatRequestAttachmentBase {
	readonly kind: ChatRequestAttachmentKind.Editor;
	readonly resource: URI;
	readonly document: WritingEditorDocument;
	readonly selection: WritingEditorSelection | null;
}

export interface IChatRequestImageAttachment
	extends IChatRequestAttachmentBase, IChatImageAttachment {
	readonly kind: ChatRequestAttachmentKind.Image;
}

export type IChatRequestAttachment =
	| IChatRequestResourceAttachment
	| IChatRequestTextAttachment
	| IChatRequestArticleAttachment
	| IChatRequestEditorAttachment
	| IChatRequestImageAttachment;

/** Immutable input submitted from one addressed Chat view. */
export interface IChatRequest {
	readonly prompt: string;
	readonly attachments: readonly IChatRequestAttachment[];
}
