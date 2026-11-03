-- CreateTable
CREATE TABLE "linkedin_searches" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "keywords" TEXT NOT NULL,
    "location" TEXT,
    "estado" INTEGER NOT NULL DEFAULT 1,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,

    CONSTRAINT "linkedin_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linkedin_posts" (
    "id" UUID NOT NULL,
    "search_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "linkedin_post_url" TEXT NOT NULL,
    "recruiter_name" TEXT,
    "company" TEXT,
    "title" TEXT,
    "content_snippet" TEXT,
    "posted_at" TIMESTAMP(3),
    "scraped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prospect_email" TEXT,
    "prospect_name" TEXT,
    "email_subject" TEXT,
    "email_body" TEXT,
    "email_status" TEXT NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMP(3),
    "sent_by" TEXT,
    "smtp_response" TEXT,
    "estado" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,

    CONSTRAINT "linkedin_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "estado" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "linkedin_searches_user_id_estado_idx" ON "linkedin_searches"("user_id", "estado");

-- CreateIndex
CREATE INDEX "linkedin_posts_user_id_estado_idx" ON "linkedin_posts"("user_id", "estado");

-- CreateIndex
CREATE INDEX "linkedin_posts_search_id_estado_idx" ON "linkedin_posts"("search_id", "estado");

-- CreateIndex
CREATE INDEX "linkedin_posts_email_status_idx" ON "linkedin_posts"("email_status");

-- CreateIndex
CREATE UNIQUE INDEX "linkedin_posts_linkedin_post_url_key" ON "linkedin_posts"("linkedin_post_url");

-- CreateIndex
CREATE INDEX "email_logs_post_id_estado_idx" ON "email_logs"("post_id", "estado");

-- CreateIndex
CREATE INDEX "email_logs_user_id_estado_idx" ON "email_logs"("user_id", "estado");

-- AddForeignKey
ALTER TABLE "linkedin_searches" ADD CONSTRAINT "linkedin_searches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linkedin_posts" ADD CONSTRAINT "linkedin_posts_search_id_fkey" FOREIGN KEY ("search_id") REFERENCES "linkedin_searches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linkedin_posts" ADD CONSTRAINT "linkedin_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "linkedin_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
