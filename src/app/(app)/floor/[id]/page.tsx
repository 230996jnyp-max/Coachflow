"use client";

import { useParams } from "next/navigation";
import { FloorScreen } from "@/components/floor/FloorScreen";

export default function FloorPage() {
  const { id } = useParams<{ id: string }>();
  return <FloorScreen sessionKey={id} />;
}
