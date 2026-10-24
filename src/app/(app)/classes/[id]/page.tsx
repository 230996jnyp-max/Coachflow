"use client";

import { useParams } from "next/navigation";
import { ClassDetail } from "@/components/groups/ClassDetail";

export default function ClassPage() {
  const { id } = useParams<{ id: string }>();
  return <ClassDetail id={id} />;
}
