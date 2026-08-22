"use client";

import { useState, type FormEvent } from "react";
import { LuColumns3, LuList, LuPlus, LuSparkles } from "react-icons/lu";

import { Dialog } from "../components/Dialog";
import { EmptyState, PageHeader } from "../components/ui";
import { useSandbox } from "../state/SandboxProvider";
import { PIPELINE_STAGES, type PipelineStage } from "./pipeline";

export function OpportunitiesClient() {
  const { dispatch, state } = useSandbox();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [organization, setOrganization] = useState("");
  const [stage, setStage] = useState<PipelineStage>("new");
  const [titleError, setTitleError] = useState("");

  const closeDialog = () => {
    setIsDialogOpen(false);
    setTitle("");
    setOrganization("");
    setStage("new");
    setTitleError("");
  };

  const submitOpportunity = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setTitleError("Saisissez un titre pour créer l’opportunité.");
      return;
    }

    const trimmedOrganization = organization.trim();
    dispatch({
      type: "CREATE_OPPORTUNITY",
      opportunity: {
        id: crypto.randomUUID(),
        title: trimmedTitle,
        stage,
        ...(trimmedOrganization ? { organization: trimmedOrganization } : {}),
      },
    });
    closeDialog();
  };

  return <div className="opportunities-page">
    <PageHeader
      eyebrow="Suivi commercial"
      title="Opportunités"
      description="Organisez les pistes réelles que vous choisissez de créer. Votre pipeline est vide tant que vous ne lui ajoutez rien."
      actions={<>
        <div aria-label="Affichage des opportunités" className="workspace-view-toggle">
          <button aria-pressed={state.pipelineView === "pipeline"} className={state.pipelineView === "pipeline" ? "is-active" : undefined} onClick={() => dispatch({ type: "SET_PIPELINE_VIEW", view: "pipeline" })} type="button"><LuColumns3 aria-hidden="true" />Pipeline</button>
          <button aria-pressed={state.pipelineView === "list"} className={state.pipelineView === "list" ? "is-active" : undefined} onClick={() => dispatch({ type: "SET_PIPELINE_VIEW", view: "list" })} type="button"><LuList aria-hidden="true" />Liste</button>
        </div>
        <button className="connection-button" onClick={() => setIsDialogOpen(true)} type="button"><LuPlus aria-hidden="true" />Nouvelle opportunité</button>
      </>}
    />

    {state.pipelineView === "pipeline" ? <section aria-label="Pipeline des opportunités" className="opportunities-pipeline">
      {PIPELINE_STAGES.map(([stageId, stageLabel]) => {
        const opportunities = state.opportunities.filter((opportunity) => opportunity.stage === stageId);

        return <section className="pipeline-column" key={stageId}>
          <header><h2>{stageLabel}</h2></header>
          {opportunities.length === 0 ? <EmptyState
            className="pipeline-column__empty"
            icon={<LuSparkles />}
            title="Aucune opportunité"
            description="Les opportunités que vous créerez dans cette étape apparaîtront ici."
          /> : <div className="opportunity-cards">
            {opportunities.map((opportunity) => <article className="opportunity-card" key={opportunity.id}>
              <strong>{opportunity.title}</strong>
              {opportunity.organization ? <span>{opportunity.organization}</span> : null}
            </article>)}
          </div>}
        </section>;
      })}
    </section> : <section aria-label="Liste des opportunités" className="opportunity-list">
      {state.opportunities.length === 0 ? <EmptyState
        icon={<LuSparkles />}
        title="Aucune opportunité à afficher"
        description="Créez votre première opportunité lorsque vous aurez une piste à suivre."
      /> : <div className="opportunity-cards">
        {state.opportunities.map((opportunity) => <article className="opportunity-card" key={opportunity.id}>
          <strong>{opportunity.title}</strong>
          {opportunity.organization ? <span>{opportunity.organization}</span> : null}
        </article>)}
      </div>}
    </section>}

    <Dialog
      description="Ajoutez uniquement une opportunité que vous souhaitez réellement suivre dans ce bac à sable."
      onClose={closeDialog}
      open={isDialogOpen}
      title="Nouvelle opportunité"
    >
      <form className="workspace-form" onSubmit={submitOpportunity}>
        <label>
          <span>Titre <em aria-hidden="true">*</em></span>
          <input aria-describedby={titleError ? "opportunity-title-error" : undefined} autoFocus onChange={(event) => { setTitle(event.target.value); setTitleError(""); }} value={title} />
          {titleError ? <small id="opportunity-title-error" role="alert">{titleError}</small> : null}
        </label>
        <label>
          <span>Organisation <i>(facultatif)</i></span>
          <input onChange={(event) => setOrganization(event.target.value)} value={organization} />
        </label>
        <label>
          <span>Étape</span>
          <select onChange={(event) => setStage(event.target.value as PipelineStage)} value={stage}>
            {PIPELINE_STAGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <div className="workspace-form__actions">
          <button className="connection-button connection-button--secondary" onClick={closeDialog} type="button">Annuler</button>
          <button className="connection-button" type="submit">Créer l’opportunité</button>
        </div>
      </form>
    </Dialog>
  </div>;
}
