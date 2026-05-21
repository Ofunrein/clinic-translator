"use client";

// Track C2. Glossary table editor — adds/edits/deletes against /api/glossary
// (B2-owned route). Fetches once, supports inline-add via the form row.

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface GlossaryRow {
  id: string;
  en: string;
  es: string;
  dialect: string | null;
  category: "medication" | "symptom" | "procedure" | "billing" | "scheduling" | "general";
}

const CATEGORIES: GlossaryRow["category"][] = [
  "medication",
  "symptom",
  "procedure",
  "billing",
  "scheduling",
  "general",
];

const KEY = ["glossary"] as const;

export function GlossaryEditor(): React.JSX.Element {
  const qc = useQueryClient();
  const q = useQuery<{ terms: GlossaryRow[] }>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetch("/api/glossary", { credentials: "include" });
      if (!res.ok) throw new Error("failed to load glossary");
      return res.json() as Promise<{ terms: GlossaryRow[] }>;
    },
  });

  const add = useMutation({
    mutationFn: async (input: Omit<GlossaryRow, "id">) => {
      const res = await fetch("/api/glossary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("failed to add term");
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });

  const [draft, setDraft] = React.useState<{
    en: string;
    es: string;
    dialect: string;
    category: GlossaryRow["category"];
  }>({ en: "", es: "", dialect: "all", category: "general" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Glossary</CardTitle>
        <CardDescription>
          Force-aligned EN/ES medical term overrides. Dialect-specific
          renderings win over `all`.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isError ? (
          <div className="text-sm text-destructive">
            Failed to load glossary.
          </div>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>English</TableHead>
              <TableHead>Spanish</TableHead>
              <TableHead>Dialect</TableHead>
              <TableHead>Category</TableHead>
              <TableHead aria-label="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data?.terms ?? []).map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.en}</TableCell>
                <TableCell>{t.es}</TableCell>
                <TableCell>{t.dialect ?? "all"}</TableCell>
                <TableCell>{t.category}</TableCell>
                <TableCell />
              </TableRow>
            ))}
            <TableRow>
              <TableCell>
                <Input
                  value={draft.en}
                  onChange={(e) => setDraft({ ...draft, en: e.target.value })}
                  placeholder="appointment"
                />
              </TableCell>
              <TableCell>
                <Input
                  value={draft.es}
                  onChange={(e) => setDraft({ ...draft, es: e.target.value })}
                  placeholder="cita"
                />
              </TableCell>
              <TableCell>
                <Select
                  value={draft.dialect}
                  onValueChange={(v) => setDraft({ ...draft, dialect: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">all</SelectItem>
                    <SelectItem value="mx">mx</SelectItem>
                    <SelectItem value="cen">cen</SelectItem>
                    <SelectItem value="car">car</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Select
                  value={draft.category}
                  onValueChange={(v) =>
                    setDraft({ ...draft, category: v as GlossaryRow["category"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Button
                  variant="outline"
                  disabled={!draft.en || !draft.es || add.isPending}
                  onClick={() => {
                    add.mutate({
                      en: draft.en.trim(),
                      es: draft.es.trim(),
                      dialect: draft.dialect === "all" ? null : draft.dialect,
                      category: draft.category,
                    });
                    setDraft({ en: "", es: "", dialect: "all", category: "general" });
                  }}
                >
                  Add
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
