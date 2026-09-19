import { LEGAL_CONTACT_EMAIL } from './legal-contact';
import { LegalSection } from './legal-document.model';

/** Machine-readable date for the `<time>` element. */
export const PRIVACY_POLICY_LAST_UPDATED_ISO = '2026-09-05';

/** Human-readable date shown to the user. */
export const PRIVACY_POLICY_LAST_UPDATED = '5 de setembro de 2026';

/**
 * Content of the privacy policy, kept as data so the page, the table of
 * contents and the anchors stay derived from a single source of truth.
 *
 * The text describes how the platform actually behaves today: authentication
 * and profile data live in Supabase; analysis always runs in the browser, but the
 * capture files of an analysis attached to an encounter are stored in a private
 * Cloudflare R2 bucket, while the standalone analyzer keeps everything in memory.
 *
 * Duas seções descrevem regras que vivem no schema, e não neste arquivo: a
 * visibilidade dos registros clínicos é a RLS (`app.can_access` e
 * `app.same_research_pool`, na migration `acervo_de_pesquisa`), e o acesso aos
 * arquivos é a URL assinada de `infrastructure/storage.py`. Mudar uma sem a outra
 * deixa publicada uma promessa que o código não cumpre, que foi exatamente o que a
 * migration do acervo de pesquisa obrigou a corrigir aqui.
 */
export const PRIVACY_POLICY_SECTIONS: LegalSection[] = [
  {
    id: 'visao-geral',
    title: 'Visão geral',
    blocks: [
      {
        kind: 'paragraph',
        text: 'O InfraJoint é uma plataforma acadêmica de apoio à pesquisa em termografia aplicada à reumatologia, desenvolvida como Trabalho de Conclusão de Curso em Ciência da Computação, em colaboração entre o Instituto de Computação e a Faculdade de Medicina da Universidade Federal Fluminense (UFF).',
      },
      {
        kind: 'paragraph',
        text: 'Esta Política de Privacidade explica quais dados pessoais são tratados quando você utiliza a plataforma, com que finalidade, por quanto tempo e quais são os seus direitos. Ela segue a Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018, a LGPD).',
      },
      {
        kind: 'paragraph',
        text: 'Ao criar uma conta e utilizar o InfraJoint, você declara ter lido e compreendido as práticas descritas neste documento.',
      },
    ],
  },
  {
    id: 'dados-coletados',
    title: 'Dados que coletamos',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Esta seção trata dos dados sobre você, usuário da plataforma. Os dados dos pacientes que você registra são tratados na seção seguinte. Sobre você, coletamos apenas o necessário para autenticar, manter o seu perfil e garantir a segurança da plataforma:',
      },
      {
        kind: 'list',
        items: [
          {
            label: 'Dados de cadastro',
            text: 'nome completo, endereço de e-mail e senha. A senha é armazenada de forma criptografada (hash) pelo serviço de autenticação e nunca fica acessível à equipe do projeto.',
          },
          {
            label: 'Login com o Google',
            text: 'ao optar por entrar com a sua conta Google, recebemos apenas o nome, o e-mail e a foto pública do seu perfil. Não temos acesso à sua senha, aos seus contatos ou ao conteúdo da sua caixa de entrada.',
          },
          {
            label: 'Foto de perfil',
            text: 'imagem opcional que você pode enviar para personalizar a sua conta.',
          },
          {
            label: 'Perfil de acesso',
            text: 'um indicador de papel (usuário, médico, pesquisador ou administrador) definido pela equipe do projeto e utilizado para liberar áreas da plataforma e determinar quais registros clínicos você alcança.',
          },
          {
            label: 'Registros técnicos',
            text: 'data, hora e endereço IP dos eventos de autenticação, registrados automaticamente pelo provedor de infraestrutura para fins de segurança.',
          },
        ],
      },
      {
        kind: 'paragraph',
        text: 'Não utilizamos cookies de publicidade, não fazemos rastreamento comportamental e não vendemos dados pessoais a terceiros.',
      },
    ],
  },
  {
    id: 'dados-de-pacientes',
    title: 'Dados de pacientes registrados por você',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Profissionais de saúde e pesquisadores autorizados podem cadastrar pacientes e registrar consultas. Esses registros descrevem terceiros, e não você, e por isso recebem tratamento à parte nesta política.',
      },
      {
        kind: 'note',
        title: 'Você é o controlador desses dados',
        text: 'Sobre os pacientes que você cadastra, a plataforma atua como operadora: guardamos e disponibilizamos as informações seguindo as suas instruções. A decisão de coletar, usar e por quanto tempo manter é sua, e com ela a responsabilidade pela base legal, pelo consentimento dos participantes e pela aprovação do comitê de ética.',
      },
      {
        kind: 'paragraph',
        text: 'Os registros clínicos armazenados são:',
      },
      {
        kind: 'list',
        items: [
          {
            label: 'Cadastro do paciente',
            text: 'nome completo, data de nascimento, sexo, telefone, os diagnósticos (pelo código da CID-10, podendo ser mais de um) e o grupo no estudo (caso ou controle). Nome e data de nascimento são obrigatórios: juntos, distinguem dois pacientes de mesmo nome.',
          },
          {
            label: 'Consulta',
            text: 'data do atendimento, motivo, a avaliação de dor e edema de cada articulação e os escores de atividade da doença calculados a partir dela, como CDAI e DAS28.',
          },
          {
            label: 'Análise de imagem',
            text: 'os arquivos das capturas, tratados na seção seguinte, e os resultados calculados sobre eles: a temperatura de cada articulação da mão e os parâmetros de alinhamento.',
          },
        ],
      },
      {
        kind: 'paragraph',
        text: 'Diagnóstico, avaliação articular e medições de temperatura são dados sensíveis de saúde, protegidos pelo art. 11 da LGPD. Nome e data de nascimento, que a plataforma exige, identificam uma pessoa com facilidade: sempre que a pesquisa permitir, use códigos de participante no lugar do nome real.',
      },
      {
        kind: 'list',
        items: [
          {
            label: 'Quem enxerga',
            text: 'no perfil de médico, cada registro é visível apenas para quem o criou. No perfil de pesquisador, os registros formam um acervo comum: os demais pesquisadores veem e podem editar os pacientes, as consultas e as análises, incluindo nome, telefone, diagnósticos e grupo no estudo. Excluir continua restrito a quem criou, toda edição fica assinada e a tela indica de quem é cada prontuário. Esse compartilhamento não alcança contas de médico. Contas administrativas têm leitura para supervisão, sem poder registrar nem alterar consulta em nome de outro profissional.',
          },
          {
            label: 'Exclusão',
            text: 'você pode excluir uma consulta ou um paciente a qualquer momento. Apagar um paciente remove todo o histórico dele: consultas, escores, análises e os arquivos de imagem no bucket.',
          },
          {
            label: 'Exportação',
            text: 'o relatório da consulta em PDF é montado no seu navegador e baixado direto para o seu computador, sem passar pelos nossos servidores.',
          },
        ],
      },
      {
        kind: 'note',
        title: 'Antes de cadastrar em uma conta de pesquisador',
        text: 'Cadastrar um paciente ali significa disponibilizá-lo a toda a equipe de pesquisa, e não apenas a você. Garanta que o consentimento do participante e a aprovação do comitê cubram esse compartilhamento antes de registrar. Se não cobrirem, use códigos no lugar do nome ou não registre o caso na plataforma.',
      },
    ],
  },
  {
    id: 'imagens-termograficas',
    title: 'Imagens termográficas e arquivos de análise',
    blocks: [
      {
        kind: 'note',
        title: 'O processamento acontece no seu navegador',
        text: 'Ler os arquivos, alinhar as imagens, segmentar a pele e calcular as temperaturas acontece tudo dentro do seu navegador. Os arquivos nunca são processados nos nossos servidores.',
      },
      {
        kind: 'list',
        items: [
          {
            label: 'Analisador avulso',
            text: 'nada é enviado nem guardado. As imagens e os arquivos de temperatura ficam só na memória do navegador e somem quando você fecha a página.',
          },
          {
            label: 'Análise registrada em uma consulta',
            text: 'os arquivos daquela sequência são guardados em um bucket privado da Cloudflare R2, hospedado na América do Norte, para que a consulta possa ser reaberta depois.',
          },
        ],
      },
      {
        kind: 'paragraph',
        text: 'O envio vai do seu navegador direto para o bucket: os arquivos não passam pelos nossos servidores em nenhum dos dois sentidos. O bucket não tem endereço público, e cada leitura depende de um link temporário de quinze minutos, gerado pela nossa API apenas para quem já tem acesso àquela consulta. O nome de cada arquivo é formado por códigos internos do sistema, então nenhum dado do paciente aparece nele. Ao excluir uma consulta ou um paciente, os arquivos correspondentes são apagados junto.',
      },
      {
        kind: 'note',
        title: 'O que cabe a você, como pesquisador',
        text: 'Imagens de pacientes são dados sensíveis de saúde. Cabe a você garantir a base legal, o consentimento do participante e a anonimização dos arquivos. E como o bucket fica fora do Brasil, o armazenamento caracteriza transferência internacional de dados (arts. 33 a 36 da LGPD): informe isso ao participante de forma destacada no termo de consentimento do estudo.',
      },
    ],
  },
  {
    id: 'finalidades',
    title: 'Para que usamos os seus dados',
    blocks: [
      {
        kind: 'list',
        items: [
          {
            label: 'Autenticação e manutenção da conta',
            text: 'identificar você com segurança a cada acesso e manter a sua sessão ativa.',
          },
          {
            label: 'Personalização da experiência',
            text: 'exibir o seu nome e a sua foto na interface e lembrar as suas preferências de uso.',
          },
          {
            label: 'Controle de acesso',
            text: 'liberar ou restringir áreas da plataforma conforme o seu perfil de acesso.',
          },
          {
            label: 'Registro e acompanhamento clínico',
            text: 'guardar os pacientes, as consultas e as análises que você registra, para que você possa reabri-los, comparar avaliações ao longo do tempo e exportar relatórios.',
          },
          {
            label: 'Segurança',
            text: 'detectar acessos indevidos, prevenir fraudes e investigar incidentes.',
          },
          {
            label: 'Evolução da plataforma',
            text: 'compreender de forma agregada como os recursos são utilizados para orientar melhorias e a pesquisa acadêmica associada ao projeto. Essa análise se limita a métricas de uso da interface e não abrange as imagens, os arquivos de temperatura nem os dados clínicos dos pacientes.',
          },
        ],
      },
      {
        kind: 'paragraph',
        text: 'Não utilizamos os seus dados para decisões automatizadas que produzam efeitos jurídicos ou que afetem significativamente os seus interesses.',
      },
      {
        kind: 'note',
        title: 'Não treinamos modelos de inteligência artificial com esses dados',
        text: 'As imagens termográficas, as fotografias, os arquivos de temperatura e os dados clínicos dos pacientes são usados exclusivamente para executar as operações que você solicita na plataforma. Não os utilizamos para treinar, ajustar ou avaliar modelos de inteligência artificial, não os incorporamos a conjuntos de dados para essa finalidade e não os cedemos a terceiros que o façam. Os algoritmos de análise da plataforma são determinísticos, rodam dentro do seu navegador e não aprendem com o material processado.',
      },
      {
        kind: 'paragraph',
        text: 'Se um dia o projeto pretender utilizar esse material para treinar modelos ou para pesquisa além do atendimento que o originou, isso dependerá de consentimento específico e destacado do titular, obtido para essa finalidade, e da aprovação do comitê de ética. Enquanto esse consentimento não existir, o uso permanece vedado.',
      },
    ],
  },
  {
    id: 'bases-legais',
    title: 'Bases legais do tratamento',
    blocks: [
      {
        kind: 'paragraph',
        text: 'O tratamento dos seus dados pessoais se apoia nas seguintes hipóteses previstas na LGPD:',
      },
      {
        kind: 'list',
        items: [
          {
            label: 'Execução de contrato (art. 7º, V)',
            text: 'para criar e manter a sua conta e disponibilizar os recursos da plataforma.',
          },
          {
            label: 'Consentimento (art. 7º, I)',
            text: 'para dados opcionais, como a foto de perfil, e para comunicações que dependam da sua autorização.',
          },
          {
            label: 'Legítimo interesse (art. 7º, IX)',
            text: 'para garantir a segurança da plataforma e prevenir usos indevidos.',
          },
          {
            label: 'Cumprimento de obrigação legal (art. 7º, II)',
            text: 'quando a guarda ou o fornecimento de informações for exigido por lei ou por autoridade competente.',
          },
          {
            label: 'Estudos por órgão de pesquisa (art. 7º, IV e art. 11, II, “c”)',
            text: 'para a finalidade acadêmica do projeto, sempre que possível com dados anonimizados.',
          },
        ],
      },
      {
        kind: 'paragraph',
        text: 'As hipóteses acima dizem respeito aos seus dados de usuário. Para os dados de saúde dos pacientes que você registra, a base legal é definida por você, na condição de controlador, entre as hipóteses do art. 11 da LGPD, tipicamente o consentimento específico do titular ou a tutela da saúde. A plataforma trata esses dados apenas para executar as operações que você solicita.',
      },
    ],
  },
  {
    id: 'compartilhamento',
    title: 'Compartilhamento com terceiros',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Não comercializamos dados pessoais. O compartilhamento ocorre apenas com os prestadores de serviço necessários ao funcionamento da plataforma, que atuam como operadores e estão obrigados contratualmente a proteger essas informações:',
      },
      {
        kind: 'list',
        items: [
          {
            label: 'Supabase',
            text: 'autenticação, banco de dados do perfil e armazenamento das fotos de perfil.',
          },
          {
            label: 'Cloudflare',
            text: 'armazenamento, em bucket privado (R2), dos arquivos das análises vinculadas a consultas.',
          },
          {
            label: 'Google',
            text: 'apenas quando você escolhe entrar com a sua conta Google, para validar a sua identidade.',
          },
          {
            label: 'Vercel',
            text: 'hospedagem e entrega da aplicação web, com os registros técnicos de acesso decorrentes.',
          },
          {
            label: 'Render',
            text: 'hospedagem da API que intermedeia os registros clínicos e assina as URLs de acesso aos arquivos.',
          },
        ],
      },
      {
        kind: 'paragraph',
        text: 'Esses prestadores fornecem infraestrutura e atuam apenas sob as nossas instruções. Não os autorizamos a acessar, analisar ou reutilizar o conteúdo armazenado para finalidades próprias, inclusive para treinar modelos de inteligência artificial. O bucket de imagens é privado e nenhum arquivo é disponibilizado a terceiros fora dessa relação de operação.',
      },
      {
        kind: 'paragraph',
        text: 'Não compartilhamos imagens, arquivos de temperatura ou registros clínicos com outras instituições, empresas ou pesquisadores externos à plataforma. Dentro dela, o acesso segue exclusivamente as regras da seção sobre dados de pacientes, e qualquer divulgação de resultados em trabalhos acadêmicos é responsabilidade do pesquisador que conduz o estudo, com dados agregados ou anonimizados.',
      },
      {
        kind: 'paragraph',
        text: 'Também poderemos compartilhar dados para cumprir ordem judicial, requisição de autoridade competente ou obrigação legal, bem como para defender os direitos do projeto e de seus usuários.',
      },
    ],
  },
  {
    id: 'armazenamento-seguranca',
    title: 'Armazenamento e segurança',
    blocks: [
      {
        kind: 'list',
        items: [
          {
            label: 'Isolamento por usuário',
            text: 'as regras de segurança do banco de dados são aplicadas linha a linha, e não apenas na interface. Para o perfil de médico, cada pessoa só lê e altera o próprio perfil e os registros que ela mesma criou. Para o perfil de pesquisador, os registros são compartilhados com os demais pesquisadores, conforme descrito na seção sobre dados de pacientes. O perfil de acesso não é modificável pelo usuário, e contas administrativas têm leitura para supervisão, sem poder assinar registros clínicos em nome de outro profissional.',
          },
          {
            label: 'Arquivos protegidos',
            text: 'as políticas de armazenamento restringem o envio e a alteração de arquivos ao respectivo dono.',
          },
          {
            label: 'Bucket privado e URLs temporárias',
            text: 'os arquivos das análises não têm endereço público e só abrem por link temporário, como descrito na seção sobre imagens.',
          },
          {
            label: 'Transmissão criptografada',
            text: 'toda a comunicação entre o seu navegador e os serviços da plataforma utiliza HTTPS/TLS.',
          },
          {
            label: 'Credenciais',
            text: 'senhas são armazenadas com algoritmos de hash e os tokens de sessão ficam no seu próprio navegador, sob controle do serviço de autenticação.',
          },
        ],
      },
      {
        kind: 'paragraph',
        text: 'Parte dos provedores mantém servidores fora do Brasil. Em particular, as imagens e os arquivos de temperatura das análises ficam em um bucket da Cloudflare R2 hospedado na América do Norte, sem restrição de jurisdição configurada. Essas transferências internacionais observam os requisitos dos arts. 33 a 36 da LGPD, e para os dados de pacientes a base que as autoriza é definida por você, na condição de controlador, conforme descrito na seção sobre imagens.',
      },
      {
        kind: 'paragraph',
        text: 'Nenhum sistema é totalmente imune a incidentes. Caso ocorra um incidente de segurança com risco relevante aos seus direitos, comunicaremos você e a Autoridade Nacional de Proteção de Dados (ANPD), conforme o art. 48 da LGPD.',
      },
    ],
  },
  {
    id: 'retencao',
    title: 'Por quanto tempo mantemos os dados',
    blocks: [
      {
        kind: 'list',
        items: [
          {
            label: 'Dados de conta e perfil',
            text: 'mantidos enquanto a sua conta estiver ativa.',
          },
          {
            label: 'Após a exclusão da conta',
            text: 'os dados são eliminados ou anonimizados, ressalvadas as hipóteses de guarda obrigatória previstas em lei.',
          },
          {
            label: 'Registros técnicos de acesso',
            text: 'mantidos por período limitado, para fins de segurança e auditoria.',
          },
          {
            label: 'Pacientes, consultas e análises',
            text: 'mantidos enquanto você não os excluir e, no máximo, enquanto a sua conta existir. Você decide quando apagá-los, e a exclusão é imediata e definitiva.',
          },
          {
            label: 'Arquivos do analisador avulso',
            text: 'não são retidos: existem apenas durante a sessão no seu navegador.',
          },
          {
            label: 'Arquivos de análises de consultas',
            text: 'ficam armazenados enquanto a consulta existir e são apagados do bucket quando você exclui a consulta, o paciente ou a sua conta.',
          },
        ],
      },
    ],
  },
  {
    id: 'cookies',
    title: 'Cookies e armazenamento local',
    blocks: [
      {
        kind: 'paragraph',
        text: 'A plataforma utiliza o armazenamento local do navegador para guardar o token da sua sessão e manter você conectado entre visitas. Esse recurso é essencial ao funcionamento do login.',
      },
      {
        kind: 'paragraph',
        text: 'Não utilizamos cookies de publicidade, de perfilamento ou de redes sociais. Você pode limpar esses dados a qualquer momento pelas configurações do seu navegador, e ao fazê-lo será necessário entrar novamente.',
      },
    ],
  },
  {
    id: 'direitos',
    title: 'Os seus direitos como titular',
    blocks: [
      {
        kind: 'paragraph',
        text: 'A LGPD assegura a você, a qualquer momento e mediante requisição, os seguintes direitos:',
      },
      {
        kind: 'list',
        items: [
          { text: 'confirmar a existência de tratamento dos seus dados' },
          { text: 'acessar os dados que mantemos sobre você' },
          { text: 'corrigir dados incompletos, inexatos ou desatualizados' },
          {
            text: 'solicitar a anonimização, o bloqueio ou a eliminação de dados desnecessários ou tratados em desconformidade com a lei',
          },
          { text: 'solicitar a portabilidade dos dados a outro fornecedor de serviço' },
          { text: 'obter informação sobre com quem os seus dados são compartilhados' },
          { text: 'revogar o consentimento e solicitar a exclusão da sua conta' },
          { text: 'opor-se a tratamento realizado com fundamento em outra base legal.' },
        ],
      },
      {
        kind: 'paragraph',
        text: 'Parte desses direitos pode ser exercida diretamente na plataforma: o seu nome e a sua foto de perfil podem ser atualizados na página de perfil. Para os demais pedidos, entre em contato pelo canal abaixo. Responderemos em até 15 dias, conforme o art. 19 da LGPD.',
      },
      {
        kind: 'paragraph',
        text: 'Se você é paciente e quer exercer esses direitos sobre os seus dados registrados na plataforma, procure o profissional de saúde ou o pesquisador responsável pelo seu atendimento: é ele quem controla esses registros e quem pode acessá-los, corrigi-los ou excluí-los. Recebendo um pedido desse tipo, nós o encaminharemos ao profissional responsável.',
      },
    ],
  },
  {
    id: 'menores',
    title: 'Crianças e adolescentes',
    blocks: [
      {
        kind: 'paragraph',
        text: 'O acesso à plataforma é destinado a pesquisadores e profissionais de saúde maiores de 18 anos. Não coletamos intencionalmente dados de crianças e adolescentes como usuários do sistema.',
      },
      {
        kind: 'paragraph',
        text: 'Quando a pesquisa envolver participantes menores de idade, o consentimento específico dos pais ou responsáveis e a aprovação do comitê de ética competente são responsabilidade do pesquisador, nos termos do art. 14 da LGPD.',
      },
    ],
  },
  {
    id: 'alteracoes',
    title: 'Alterações desta política',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Esta política pode ser atualizada para refletir mudanças na plataforma ou na legislação aplicável. A data da última atualização é sempre exibida no início da página.',
      },
      {
        kind: 'paragraph',
        text: 'Alterações relevantes serão comunicadas pelos canais disponíveis antes de entrarem em vigor. Recomendamos revisar este documento periodicamente.',
      },
    ],
  },
  {
    id: 'contato',
    title: 'Contato',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Para exercer os seus direitos, esclarecer dúvidas sobre esta política ou comunicar um incidente, fale com a equipe responsável pelo tratamento de dados do InfraJoint:',
      },
      {
        kind: 'contact',
        label: 'Encarregado pelo tratamento de dados',
        email: LEGAL_CONTACT_EMAIL,
      },
      {
        kind: 'paragraph',
        text: 'Você também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD), por meio dos canais oficiais do órgão.',
      },
    ],
  },
];
