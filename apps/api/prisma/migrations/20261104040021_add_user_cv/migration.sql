-- CreateTable
CREATE TABLE "user_cvs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "text" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_cvs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_cvs_user_id_idx" ON "user_cvs"("user_id");

-- AddForeignKey
ALTER TABLE "user_cvs" ADD CONSTRAINT "user_cvs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
