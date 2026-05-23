"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ClinicSettingsPatch } from "@/lib/settings";

function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function listToLines(items: string[]): string {
  return items.join("\n");
}

function SectionSave({
  label,
  onSave,
  pending,
  error,
}: {
  label: string;
  onSave: () => void;
  pending: boolean;
  error: string | null;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
      {error ? <span className="text-sm text-destructive">{error}</span> : null}
      <Button onClick={onSave} disabled={pending} size="sm" className="w-full sm:w-auto">
        {pending ? "Saving…" : label}
      </Button>
    </div>
  );
}

export interface ClinicKnowledgeDraft {
  clinicName: string;
  clinicHours: string;
  clinicAfterHours: string | null;
  clinicTransferPhone: string | null;
  clinicPolicyNotes: string | null;
  clinicServices: string[];
  clinicFaqBullets: string[];
  dialect: "mx" | "cen" | "car" | "other";
}

export function ClinicKnowledgeTab({
  draft,
  onChange,
  onSaveSection,
  pending,
  sectionError,
}: {
  draft: ClinicKnowledgeDraft;
  onChange: (patch: Partial<ClinicKnowledgeDraft>) => void;
  onSaveSection: (patch: ClinicSettingsPatch) => void;
  pending: boolean;
  sectionError: string | null;
}): React.JSX.Element {
  const [profileError, setProfileError] = React.useState<string | null>(null);
  const [knowledgeError, setKnowledgeError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!pending && !sectionError) {
      setProfileError(null);
      setKnowledgeError(null);
    }
  }, [pending, sectionError]);

  const saveProfile = (): void => {
    setProfileError(null);
    onSaveSection({
      clinicName: draft.clinicName.trim(),
      clinicHours: draft.clinicHours.trim(),
      clinicAfterHours: draft.clinicAfterHours?.trim() || null,
      clinicTransferPhone: draft.clinicTransferPhone?.trim() || null,
      dialect: draft.dialect,
    });
  };

  const saveKnowledge = (): void => {
    setKnowledgeError(null);
    onSaveSection({
      clinicServices: draft.clinicServices,
      clinicPolicyNotes: draft.clinicPolicyNotes?.trim() || null,
      clinicFaqBullets: draft.clinicFaqBullets,
    });
  };

  const err = sectionError;
  const profileErr = profileError ?? (err && pending ? err : null);
  const knowledgeErr = knowledgeError ?? (err && pending ? err : null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Clinic profile</CardTitle>
          <CardDescription>
            Basic identity and hours. Used when Groq drafts English replies for
            staff during live calls.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input
              value={draft.clinicName}
              onChange={(e) => onChange({ clinicName: e.target.value })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Hours</label>
            <Textarea
              value={draft.clinicHours}
              onChange={(e) => onChange({ clinicHours: e.target.value })}
              rows={2}
              placeholder="Monday–Friday, 8:00 AM to 5:00 PM Central"
            />
          </div>
          <div>
            <label className="text-sm font-medium">After-hours message</label>
            <Textarea
              value={draft.clinicAfterHours ?? ""}
              onChange={(e) =>
                onChange({ clinicAfterHours: e.target.value || null })
              }
              rows={2}
              placeholder="After 5 PM, leave a voicemail; we return calls next business day."
            />
          </div>
          <div>
            <label className="text-sm font-medium">Transfer phone</label>
            <Input
              value={draft.clinicTransferPhone ?? ""}
              onChange={(e) =>
                onChange({ clinicTransferPhone: e.target.value || null })
              }
              placeholder="+1-512-555-0100"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Default dialect</label>
            <Select
              value={draft.dialect}
              onValueChange={(v) =>
                onChange({ dialect: v as ClinicKnowledgeDraft["dialect"] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mx">Mexican (mx)</SelectItem>
                <SelectItem value="cen">Central American (cen)</SelectItem>
                <SelectItem value="car">Caribbean (car)</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <SectionSave
            label="Save profile"
            onSave={saveProfile}
            pending={pending}
            error={profileErr}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Policies &amp; FAQs</CardTitle>
          <CardDescription>
            One item per line. Groq reads these when suggesting replies — not
            injected into live translation (use the Glossary tab for that).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-sm font-medium">Services offered</label>
            <Textarea
              value={listToLines(draft.clinicServices)}
              onChange={(e) =>
                onChange({ clinicServices: linesToList(e.target.value) })
              }
              rows={5}
              placeholder={"primary care visits\nphysicals\nvaccinations"}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Policy notes</label>
            <Textarea
              value={draft.clinicPolicyNotes ?? ""}
              onChange={(e) =>
                onChange({ clinicPolicyNotes: e.target.value || null })
              }
              rows={4}
              placeholder="We do not refill Schedule II medications by phone."
            />
          </div>
          <div>
            <label className="text-sm font-medium">Common FAQs</label>
            <Textarea
              value={listToLines(draft.clinicFaqBullets)}
              onChange={(e) =>
                onChange({ clinicFaqBullets: linesToList(e.target.value) })
              }
              rows={5}
              placeholder={
                "Parking is free in the lot behind the building.\nWe accept most major insurance; call billing for eligibility."
              }
            />
          </div>
          <SectionSave
            label="Save policies & FAQs"
            onSave={saveKnowledge}
            pending={pending}
            error={knowledgeErr}
          />
        </CardContent>
      </Card>
    </div>
  );
}
