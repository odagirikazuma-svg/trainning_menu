"use client";

import { useParams } from "next/navigation";
import AuthGate from "../../components/AuthGate";
import MemberDetailPage from "../../components/MemberDetailPage";

export default function TeamMemberRoute() {
  const params = useParams<{ memberId: string }>();
  const memberId = Array.isArray(params.memberId)
    ? params.memberId[0]
    : params.memberId;

  return (
    <AuthGate>
      {(profile) =>
        memberId ? (
          <MemberDetailPage profile={profile} memberId={memberId} />
        ) : null
      }
    </AuthGate>
  );
}
