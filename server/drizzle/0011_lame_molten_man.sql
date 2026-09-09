ALTER TABLE "passkey" RENAME TO "passkeys";--> statement-breakpoint
ALTER TABLE "permission" RENAME TO "permissions";--> statement-breakpoint
ALTER TABLE "role_permission" RENAME TO "roles_permissions";--> statement-breakpoint
ALTER TABLE "role" RENAME TO "roles";--> statement-breakpoint
ALTER TABLE "session" RENAME TO "sessions";--> statement-breakpoint
ALTER TABLE "token" RENAME TO "tokens";--> statement-breakpoint
ALTER TABLE "user_role" RENAME TO "users_roles";--> statement-breakpoint
ALTER TABLE "passkeys" DROP CONSTRAINT "passkey_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "roles_permissions" DROP CONSTRAINT "role_permission_role_id_role_id_fk";
--> statement-breakpoint
ALTER TABLE "roles_permissions" DROP CONSTRAINT "role_permission_permission_id_permission_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "session_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tokens" DROP CONSTRAINT "token_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "users_roles" DROP CONSTRAINT "user_role_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "users_roles" DROP CONSTRAINT "user_role_role_id_role_id_fk";
--> statement-breakpoint
ALTER TABLE "roles_permissions" DROP CONSTRAINT "role_permission_role_id_permission_id_pk";--> statement-breakpoint
ALTER TABLE "users_roles" DROP CONSTRAINT "user_role_user_id_role_id_pk";--> statement-breakpoint
ALTER TABLE "roles_permissions" ADD CONSTRAINT "roles_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id");--> statement-breakpoint
ALTER TABLE "users_roles" ADD CONSTRAINT "users_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id");--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles_permissions" ADD CONSTRAINT "roles_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles_permissions" ADD CONSTRAINT "roles_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users_roles" ADD CONSTRAINT "users_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users_roles" ADD CONSTRAINT "users_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;