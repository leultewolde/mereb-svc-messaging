CREATE TABLE "ConversationParticipantState" (
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationParticipantState_pkey" PRIMARY KEY ("conversationId","userId")
);

CREATE INDEX "ConversationParticipantState_userId_idx"
    ON "ConversationParticipantState"("userId");

INSERT INTO "ConversationParticipantState" (
    "conversationId",
    "userId",
    "unreadCount",
    "lastReadAt",
    "createdAt",
    "updatedAt"
)
SELECT
    conversation."id",
    participant."userId",
    0,
    latest_message."sentAt",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Conversation" AS conversation
CROSS JOIN LATERAL unnest(conversation."participantIds") AS participant("userId")
LEFT JOIN LATERAL (
    SELECT message."sentAt"
    FROM "Message" AS message
    WHERE message."conversationId" = conversation."id"
    ORDER BY message."sentAt" DESC
    LIMIT 1
) AS latest_message ON TRUE;

ALTER TABLE "ConversationParticipantState"
    ADD CONSTRAINT "ConversationParticipantState_conversationId_fkey"
    FOREIGN KEY ("conversationId")
    REFERENCES "Conversation"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
