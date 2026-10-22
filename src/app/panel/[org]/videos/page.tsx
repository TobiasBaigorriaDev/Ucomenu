import type { Metadata } from "next";
import Image from "next/image";
import { getEntitlements, requireMembership } from "@/lib/auth/session";
import { createSessionClient } from "@/lib/supabase/server";
import {
  canPublish,
  canUnpublish,
  formatDuration,
  hasPendingVideos,
  isUploadExpired,
  MUX_ERROR_LABEL,
  MUX_STATUS_LABEL,
  quotaText,
  STATUS_LABEL,
  type VideoRow,
} from "@/lib/videos/estado";
import { muxConfig, thumbnailUrl } from "@/lib/videos/mux";
import { loadProductOptions, loadVideos } from "@/lib/videos/videos";
import { DeleteVideoForm, PublishVideoForm, SaveVideoForm } from "./video-forms";
import { UploadVideoForm, VideosAutoRefresh } from "./video-upload";

export const metadata: Metadata = { title: "Videos" };

const badgeClass = "inline-flex items-center rounded-full border border-ink/25 bg-sand px-2.5 py-0.5 text-sm text-ink";
const badgeStrongClass = "inline-flex items-center rounded-full bg-ink px-2.5 py-0.5 text-sm font-medium text-white";

/**
 * Videos del feed (fichas videos-del-panel-base y videos-mux-parte-b, ADR 0031): subida, lista del local con su estado de
 * procesamiento y de publicación, el cupo del plan y las acciones de Dueño y Staff. La base vuelve a comprobar todo: plan,
 * cupo, cuenta al día y pertenencia; esta pantalla lo muestra con mensajes claros, no lo reemplaza.
 */
export default async function VideosPage({ params }: PageProps<"/panel/[org]/videos">) {
  const { org } = await params;
  const { membership } = await requireMembership(org, `/panel/${org}/videos`);
  const orgId = membership.org.id;
  const db = await createSessionClient();

  const [ent, videos] = await Promise.all([getEntitlements(orgId), loadVideos(db, orgId)]);
  // Falla cerrado: sin poder leer la cuenta, se muestra pero no se edita.
  const canWrite = ent?.canWrite === true;
  const hasFeed = ent?.features.includes("video_feed") === true;
  const now = new Date();
  const uploadConfigured = muxConfig() !== null;
  // Los platos hacen falta para enlazar (en la lista y en el formulario de subida) solo si se va a poder usar alguno de los dos.
  const products = videos.length > 0 || hasFeed ? await loadProductOptions(db, orgId) : [];
  const productName = new Map(products.map((product) => [product.id, product.name]));
  const quota = quotaText(ent?.usage.videos_published, ent?.limits.videos_published);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <h1 className="font-display text-4xl leading-tight">Videos</h1>
      <p className="mt-2 max-w-prose text-base text-muted">
        Videos cortos del local que se muestran en la carta, como un feed. Duran hasta 30 segundos y se publican cuando están listos.
      </p>

      {!ent ? (
        <p role="status" className="mt-4 max-w-prose text-base text-muted" data-testid="videos-sin-estado">
          No pudimos comprobar el estado de la cuenta, así que la edición está desactivada.
        </p>
      ) : !hasFeed ? (
        <p className="panel-cell mt-6 max-w-prose text-base" data-testid="videos-sin-plan">
          {ent.state === "suspended"
            ? "La cuenta está suspendida: los videos no se muestran hasta regularizar el pago."
            : "El feed de videos está incluido en el plan Premium. Tus videos, si tenés, se conservan y vuelven a funcionar al volver a Premium."}
        </p>
      ) : null}

      {quota && hasFeed ? (
        <p className="mt-4 text-lg" data-testid="videos-cupo">
          Publicados: <strong>{quota}</strong>
        </p>
      ) : null}

      {hasFeed ? (
        <UploadVideoForm
          orgSlug={membership.org.slug}
          products={products}
          enabled={canWrite && uploadConfigured}
          notice={
            !canWrite
              ? "Tu cuenta está en solo lectura: no se pueden subir videos hasta regularizar el pago."
              : !uploadConfigured
                ? "La subida de videos todavía no está configurada en este servidor. Avisale al equipo de UcoMenu."
                : null
          }
        />
      ) : null}
      {hasPendingVideos(videos, now) ? <VideosAutoRefresh /> : null}

      {videos.length === 0 ? (
        <p className="mt-8 max-w-prose text-lg text-muted" data-testid="videos-vacio">
          Todavía no hay videos.{hasFeed ? " Subí el primero desde acá." : ""}
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-4">
          {videos.map((video) => (
            <VideoItem
              key={video.id}
              video={video}
              orgSlug={membership.org.slug}
              products={products}
              plato={video.product_id ? (productName.get(video.product_id) ?? null) : null}
              canWrite={canWrite}
              canPublishNow={canWrite && hasFeed}
              now={now}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

function VideoItem({
  video,
  orgSlug,
  products,
  plato,
  canWrite,
  canPublishNow,
  now,
}: {
  video: VideoRow;
  orgSlug: string;
  products: { id: string; name: string }[];
  plato: string | null;
  canWrite: boolean;
  canPublishNow: boolean;
  now: Date;
}) {
  const deleting = video.status === "deleting";
  const expired = isUploadExpired(video, now);
  const duration = formatDuration(video.duration_seconds);

  return (
    <li className="panel-cell min-w-0" data-testid="video" data-video={video.id} data-status={video.status} data-mux={video.mux_status}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 font-display text-2xl leading-tight [overflow-wrap:anywhere]" data-testid="video-titulo">
          {video.title}
        </h2>
        <span className={video.status === "published" ? badgeStrongClass : badgeClass} data-testid="video-estado">
          {STATUS_LABEL[video.status]}
        </span>
        <span className={badgeClass} data-testid="video-procesamiento">
          {expired ? "Subida vencida" : MUX_STATUS_LABEL[video.mux_status]}
        </span>
        {duration ? <span className={badgeClass}>{duration}</span> : null}
      </div>
      <p className="mt-1 text-base text-muted" data-testid="video-plato">
        {plato ? `Muestra el plato: ${plato}` : "No está enlazado a un plato."}
      </p>
      {video.mux_status === "errored" && video.mux_error ? (
        <p className="mt-2 text-base font-medium text-danger" data-testid="video-error">
          {MUX_ERROR_LABEL[video.mux_error]} Borralo y subí otro.
        </p>
      ) : null}
      {expired ? (
        <p className="mt-2 text-base text-muted" data-testid="video-vencido">
          La subida no se completó. Borralo y volvé a subirlo.
        </p>
      ) : null}
      {video.mux_status === "ready" && video.mux_playback_id && !deleting ? (
        <Image
          src={thumbnailUrl(video.mux_playback_id)}
          alt=""
          width={90}
          height={160}
          unoptimized
          className="mt-3 h-40 w-[5.625rem] rounded-xl border border-ink/15 bg-sand object-cover"
          data-testid="video-miniatura"
        />
      ) : null}

      {deleting ? (
        <div className="mt-4">
          <DeleteVideoForm orgSlug={orgSlug} id={video.id} title={video.title} deleting canWrite={canWrite} />
        </div>
      ) : (
        <div className="mt-4 grid gap-5">
          <SaveVideoForm orgSlug={orgSlug} id={video.id} title={video.title} productId={video.product_id} products={products} canWrite={canWrite} />
          <div className="flex flex-wrap items-start gap-3">
            <PublishVideoForm
              orgSlug={orgSlug}
              id={video.id}
              title={video.title}
              published={video.status === "published"}
              enabled={canUnpublish(video) ? canWrite : canPublish(video) && canPublishNow}
            />
            <DeleteVideoForm orgSlug={orgSlug} id={video.id} title={video.title} deleting={false} canWrite={canWrite} />
          </div>
        </div>
      )}
    </li>
  );
}
