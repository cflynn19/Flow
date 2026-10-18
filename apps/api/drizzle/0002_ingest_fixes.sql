CREATE TABLE "ingest_event_ids" (
	"execution_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	CONSTRAINT "ingest_event_ids_execution_id_event_id_pk" PRIMARY KEY("execution_id","event_id")
);
--> statement-breakpoint
DROP INDEX "executions_external_id_unique";--> statement-breakpoint
ALTER TABLE "ingest_event_ids" ADD CONSTRAINT "ingest_event_ids_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "executions_workflow_external_id_unique" ON "executions" USING btree ("workflow_id","external_id");