import { Message, Session } from "@prisma/client";
import { randomUUID } from "node:crypto";

interface CreateSessionArgs {
  data: { title: string | null };
}

interface CreateMessageArgs {
  data: { sessionId: string; role: Message["role"]; content: string };
}

/**
 * Minimal in-memory stand-in for PrismaService, implementing only the calls
 * SessionsService actually makes. Lets the sessions e2e suite exercise real
 * HTTP request/response cycles without depending on a running Postgres.
 */
export class InMemoryPrismaService {
  private readonly sessions = new Map<string, Session>();
  private readonly messages: Message[] = [];

  session = {
    create: ({ data }: CreateSessionArgs): Promise<Session> => {
      const now = new Date();
      const session: Session = {
        id: randomUUID(),
        title: data.title,
        createdAt: now,
        updatedAt: now,
      };
      this.sessions.set(session.id, session);
      return Promise.resolve(session);
    },
    findMany: (): Promise<Session[]> => {
      const all = [...this.sessions.values()].sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
      );
      return Promise.resolve(all);
    },
    findUnique: ({ where: { id } }: { where: { id: string } }): Promise<Session | null> => {
      return Promise.resolve(this.sessions.get(id) ?? null);
    },
    update: ({
      where: { id },
      data,
    }: {
      where: { id: string };
      data: Partial<Session>;
    }): Promise<Session> => {
      const existing = this.sessions.get(id);
      if (existing === undefined) {
        throw new Error(`Session ${id} not found`);
      }
      const updated = { ...existing, ...data };
      this.sessions.set(id, updated);
      return Promise.resolve(updated);
    },
    delete: ({ where: { id } }: { where: { id: string } }): Promise<Session> => {
      const existing = this.sessions.get(id);
      if (existing === undefined) {
        throw new Error(`Session ${id} not found`);
      }
      this.sessions.delete(id);
      for (let i = this.messages.length - 1; i >= 0; i -= 1) {
        if (this.messages[i].sessionId === id) {
          this.messages.splice(i, 1);
        }
      }
      return Promise.resolve(existing);
    },
  };

  message = {
    create: ({ data }: CreateMessageArgs): Promise<Message> => {
      const message: Message = { id: randomUUID(), createdAt: new Date(), ...data };
      this.messages.push(message);
      return Promise.resolve(message);
    },
    findMany: ({ where: { sessionId } }: { where: { sessionId: string } }): Promise<Message[]> => {
      const results = this.messages
        .filter((message) => message.sessionId === sessionId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return Promise.resolve(results);
    },
  };
}
