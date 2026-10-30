import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { createSessionClient } from "@/lib/supabase/server";
import { loadModerationList, LIST_LIMIT, PENDING_CAP, PENDING_RETENTION_DAYS, REJECTED_RETENTION_DAYS, type ModerationComment, type ModerationList } from "@/lib/videos/moderacion";
import { loadVideos } from "@/lib/videos/videos";
import { ModerateCommentForm } from "./comment-forms";

export const metadata: Metadata = { title: "Comentarios" };

const DAY_MS = 24 * 60 * 60 * 1000;
const badgeClass = "inline-flex items-center rounded-full border border-ink/25 bg-sand px-2.5 py-0.5 text-sm text-ink";

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const dateOnly = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" });

/**
 * Cola de moderación de comentarios del feed (ficha comentarios-del-feed, ADR 0031) para Dueño y Staff. Los comensales comentan desde
 * la mesa; nada se ve en la carta hasta que se aprueba acá. La base vuelve a comprobar todo (membresía, cuenta al día para aprobar);
 * esta pantalla lo muestra con mensajes claros, no lo reemplaza.
 */
export default async function CommentsPage({ params }: PageProps<"/panel/[org]/comentarios">) {
  const { org } = await params;
  const { membership } = await requireMembership(org, `/panel/${org}/comentarios`);
  const orgId = membership.org.id;
  const db = await createSessionClient();

  const [ent, videos, pending, approved, rejected] = await Promise.all([
    getEntitlements(orgId),
    loadVideos(db, orgId),
    loadModerationList(db, orgId, "pending"),
    loadModerationList(db, orgId, "approved"),
    loadModerationList(db, orgId, "rejected"),
  ]);
  const titles = new Map(videos.map((video) => [video.id, video.title]));
  // Falla cerrado: sin poder leer la cuenta no se aprueba (rechazar siempre se puede).
  const canApprove = ent?.canWrite === true;
  const hasFeed = ent?.features.includes("video_feed") === true;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Comentarios</h1>
      <p className="mt-2 max-w-prose text-base text-muted">
        Lo que dejan los comensales en tus videos desde el QR de la mesa. No se ve en la carta hasta que lo aprobás, y podés retirarlo cuando quieras.
      </p>

      {!ent ? (
        <p role="status" className="mt-4 max-w-prose text-base text-muted" data-testid="comentarios-sin-estado">
          No pudimos comprobar el estado de la cuenta, así que no se puede aprobar. Rechazar sí.
        </p>
      ) : !hasFeed ? (
        <p className="panel-cell mt-6 max-w-prose text-base" data-testid="comentarios-sin-plan">
          {ent.state === "suspended"
            ? "La cuenta está suspendida: los videos y sus comentarios no se muestran hasta regularizar el pago."
            : "El feed de videos y sus comentarios están incluidos en el plan Pro. Lo que ya recibiste se conserva y vuelve a verse al pasar a Pro."}
        </p>
      ) : !canApprove ? (
        <p className="panel-cell mt-6 max-w-prose text-base" data-testid="comentarios-solo-lectura">
          Tu cuenta está en solo lectura: los comensales no pueden comentar y no se puede aprobar hasta regularizar el pago. Sí podés rechazar y retirar comentarios.
        </p>
      ) : null}

      <Section
        title="Pendientes"
        testid="comentarios-pendientes"
        list={pending}
        titles={titles}
        empty="No hay comentarios para revisar."
        note={
          pending.total >= PENDING_CAP
            ? `Hay ${PENDING_CAP} o más comentarios por revisar: los comensales no pueden enviar más hasta que apruebes o rechaces algunos.`
            : `Los que no revises se borran a los ${PENDING_RETENTION_DAYS} días de enviados.`
        }
      >
        {(comment) => (
          <>
            <ModerateCommentForm orgSlug={org} id={comment.id} intent="approve" label="Aprobar" tone="primary" enabled={canApprove} accessibleSuffix={`el comentario de ${comment.alias ?? "un comensal sin nombre"}`} />
            <ModerateCommentForm orgSlug={org} id={comment.id} intent="reject" label="Rechazar" tone="danger" accessibleSuffix={`el comentario de ${comment.alias ?? "un comensal sin nombre"}`} />
          </>
        )}
      </Section>
      <Section title="Publicados" testid="comentarios-publicados" list={approved} empty="Todavía no publicaste ningún comentario." titles={titles}>
        {(comment) => <ModerateCommentForm orgSlug={org} id={comment.id} intent="reject" label="Retirar" tone="secondary" accessibleSuffix={`el comentario de ${comment.alias ?? "un comensal sin nombre"}`} />}
      </Section>
      <Section
        title="Rechazados"
        testid="comentarios-rechazados"
        list={rejected}
        empty="No hay comentarios rechazados."
        note={`Se borran definitivamente a los ${REJECTED_RETENTION_DAYS} días de rechazados. Hasta entonces podés aprobarlos de nuevo.`}
        titles={titles}
        deleteOn
      >
        {(comment) => <ModerateCommentForm orgSlug={org} id={comment.id} intent="approve" label="Aprobar de nuevo" tone="secondary" enabled={canApprove} accessibleSuffix={`el comentario de ${comment.alias ?? "un comensal sin nombre"}`} />}
      </Section>
    </main>
  );
}

function Section({
  title,
  testid,
  list,
  empty,
  note,
  titles,
  deleteOn = false,
  children,
}: {
  title: string;
  testid: string;
  list: ModerationList;
  empty: string;
  note?: string;
  titles: Map<string, string>;
  deleteOn?: boolean;
  children: (comment: ModerationComment) => ReactNode;
}) {
  return (
    <section className="mt-10" aria-labelledby={`${testid}-titulo`} data-testid={testid}>
      <h2 id={`${testid}-titulo`} className="font-display text-2xl leading-tight">
        {title} <span className="text-lg text-muted tabular-nums" data-testid={`${testid}-total`}>({list.total})</span>
      </h2>
      {note ? <p className="mt-1 max-w-prose text-base text-muted">{note}</p> : null}
      {list.rows.length === 0 ? (
        <p className="mt-3 text-base text-muted" data-testid={`${testid}-vacio`}>
          {empty}
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3">
          {list.rows.map((comment) => (
            <li key={comment.id} className="panel-cell min-w-0" data-testid="comentario" data-comment={comment.id} data-status={comment.status}>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <span className="font-semibold text-ink [overflow-wrap:anywhere]" data-testid="comentario-alias">
                  {comment.alias ?? "Sin nombre"}
                </span>
                <span>{dateTime(comment.created_at)}</span>
                <span className={badgeClass} data-testid="comentario-video">
                  {titles.get(comment.video_id) ?? "Video borrado"}
                </span>
                {deleteOn && comment.moderated_at ? (
                  <span data-testid="comentario-borrado">Se borra el {dateOnly(new Date(new Date(comment.moderated_at).getTime() + REJECTED_RETENTION_DAYS * DAY_MS).toISOString())}</span>
                ) : null}
              </div>
              <p className="mt-2 text-lg leading-snug [overflow-wrap:anywhere]" data-testid="comentario-texto">
                {comment.body}
              </p>
              <div className="mt-3 flex flex-wrap items-start gap-3">{children(comment)}</div>
            </li>
          ))}
        </ul>
      )}
      {list.total > LIST_LIMIT ? (
        <p className="mt-3 text-base text-muted" data-testid={`${testid}-mas`}>
          Mostramos los {LIST_LIMIT} {title === "Pendientes" ? "que más esperan" : "más recientes"}.
        </p>
      ) : null}
    </section>
  );
}
