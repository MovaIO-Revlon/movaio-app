export const environment = {
  production: true,
  apiUrl: '/api',
  baseUrl: 'https://movate-dev.revlon.com/',
  WebSocketPath:'/api/socket.io',
  SessionTclsime: 30,
  isMinDateMonth: true,
  minDateOffsetMonthsOrDate: 2,
  refUrl: 'https://movate-dev.revlon.com/managesubscription',
  masterDatabase: 'App Engineering',
  masterprojectName: ['App Engineering', 'dev_qa'],
  masterdatabaseName: ['dev_qa', 'master'],
  masterProjectDisplayName: 'AI Infused Engineering',
  domainName: '@revlon.com',
  IsNewPort: false,
  rag: {
    knowledgeGraphProviders: ['neo4j', 'neptune'] as const,
    // optional: you can also add the helper function here
    isKnowledgeGraph(provider: string | null | undefined): boolean {
      if (!provider) return false;
      const normalized = provider.toLowerCase().trim();
      return this.knowledgeGraphProviders.some(keyword =>
        normalized.includes(keyword)
      );
    }
  }
};
