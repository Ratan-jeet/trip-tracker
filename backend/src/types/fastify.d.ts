import 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    /** Set by the `authenticate` pre-handler; always present on a guarded route. */
    currentUserId: string;
  }
}
