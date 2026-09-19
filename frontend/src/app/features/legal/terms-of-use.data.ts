import { LEGAL_CONTACT_EMAIL } from './legal-contact';
import { LegalSection } from './legal-document.model';

/** Machine-readable date for the `<time>` element. */
export const TERMS_OF_USE_LAST_UPDATED_ISO = '2026-09-03';

/** Human-readable date shown to the user. */
export const TERMS_OF_USE_LAST_UPDATED = '3 de setembro de 2026';

/**
 * Content of the terms of use, in the same section format as the privacy
 * policy so both documents share the `LegalDocument` layout.
 */
export const TERMS_OF_USE_SECTIONS: LegalSection[] = [
  {
    id: 'aceitacao',
    title: 'Aceitação dos termos',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Estes Termos de Uso regulam o acesso e a utilização da plataforma InfraJoint. Ao criar uma conta ou utilizar a plataforma, você concorda integralmente com as condições descritas neste documento.',
      },
      {
        kind: 'paragraph',
        text: 'Caso não concorde com algum ponto, não utilize a plataforma.',
      },
    ],
  },
  {
    id: 'sobre-a-plataforma',
    title: 'Sobre a plataforma',
    blocks: [
      {
        kind: 'paragraph',
        text: 'O InfraJoint é uma ferramenta acadêmica de apoio à pesquisa em termografia aplicada à reumatologia, desenvolvida como Trabalho de Conclusão de Curso em Ciência da Computação, em colaboração entre o Instituto de Computação e a Faculdade de Medicina da Universidade Federal Fluminense (UFF).',
      },
      {
        kind: 'paragraph',
        text: 'A plataforma permite carregar imagens térmicas e arquivos de temperatura, executar análises no próprio navegador e organizar informações de pesquisa. Trata-se de um projeto acadêmico em evolução, oferecido sem custo para fins de estudo e pesquisa.',
      },
    ],
  },
  {
    id: 'finalidade-nao-diagnostica',
    title: 'Finalidade não diagnóstica',
    blocks: [
      {
        kind: 'note',
        title: 'O InfraJoint não é um dispositivo médico',
        text: 'Os resultados apresentados têm finalidade exclusivamente acadêmica e de pesquisa. Eles não constituem diagnóstico, laudo ou recomendação de tratamento e não substituem a avaliação de um profissional de saúde qualificado.',
      },
      {
        kind: 'paragraph',
        text: 'A plataforma não possui registro na ANVISA como software médico. Qualquer decisão clínica tomada com apoio das informações geradas é de responsabilidade exclusiva do profissional responsável pelo paciente.',
      },
    ],
  },
  {
    id: 'cadastro-e-conta',
    title: 'Cadastro e conta',
    blocks: [
      {
        kind: 'list',
        items: [
          {
            label: 'Idade mínima',
            text: 'o acesso é destinado a pesquisadores, estudantes e profissionais de saúde maiores de 18 anos.',
          },
          {
            label: 'Informações verdadeiras',
            text: 'você se compromete a fornecer dados de cadastro corretos e a mantê-los atualizados.',
          },
          {
            label: 'Conta individual',
            text: 'a conta é pessoal e intransferível. Você é responsável por manter a confidencialidade das suas credenciais e por todas as atividades realizadas com elas.',
          },
          {
            label: 'Uso indevido',
            text: 'comunique imediatamente qualquer acesso não autorizado à sua conta pelo canal de contato indicado ao final deste documento.',
          },
        ],
      },
    ],
  },
  {
    id: 'responsabilidades-do-usuario',
    title: 'Responsabilidades do usuário',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Ao utilizar a plataforma, você se compromete a:',
      },
      {
        kind: 'list',
        items: [
          {
            label: 'Dados de pesquisa',
            text: 'utilizar apenas arquivos que você tenha o direito de tratar, observando o consentimento dos participantes e a aprovação do comitê de ética, quando aplicável.',
          },
          {
            label: 'Anonimização',
            text: 'remover identificadores diretos de pacientes dos arquivos antes de carregá-los, já que a plataforma não exige nenhum dado que identifique o participante.',
          },
          {
            label: 'Uso lícito',
            text: 'não utilizar a plataforma para finalidades ilegais, para violar direitos de terceiros ou de forma contrária a estes termos.',
          },
          {
            label: 'Interpretação dos resultados',
            text: 'avaliar criticamente os resultados obtidos, ciente das limitações de uma ferramenta acadêmica em desenvolvimento.',
          },
          {
            label: 'Acervo compartilhado de pesquisa',
            text: 'se a sua conta tem perfil de pesquisador, os registros que você cadastra ficam visíveis e editáveis pelos demais pesquisadores da plataforma. Ao cadastrar, você declara que a base legal, o consentimento do participante e a aprovação do comitê de ética cobrem esse compartilhamento. Ao acessar registros de outro pesquisador, use-os apenas para as finalidades do projeto e preserve a confidencialidade dos participantes.',
          },
        ],
      },
    ],
  },
  {
    id: 'condutas-vedadas',
    title: 'Condutas vedadas',
    blocks: [
      {
        kind: 'paragraph',
        text: 'É expressamente proibido:',
      },
      {
        kind: 'list',
        items: [
          { text: 'tentar acessar contas, dados ou áreas restritas que não sejam suas' },
          {
            text: 'burlar, desativar ou testar os mecanismos de autenticação e de controle de acesso sem autorização',
          },
          {
            text: 'realizar engenharia reversa, copiar ou redistribuir a plataforma sem autorização',
          },
          {
            text: 'utilizar robôs, scripts ou automações que sobrecarreguem ou prejudiquem o funcionamento do serviço',
          },
          { text: 'carregar conteúdo ilícito, ofensivo ou que viole direitos de terceiros' },
          { text: 'compartilhar as suas credenciais de acesso com outras pessoas' },
          {
            text: 'extrair, copiar ou reutilizar os registros clínicos do acervo de pesquisa para finalidades alheias ao projeto, inclusive para compor conjuntos de dados ou treinar modelos de inteligência artificial',
          },
          {
            text: 'divulgar a terceiros dados de pacientes cadastrados por outro pesquisador sem a autorização dele e sem a base legal exigida pela LGPD.',
          },
        ],
      },
      {
        kind: 'paragraph',
        text: 'O descumprimento pode resultar na suspensão ou no encerramento imediato da conta, sem prejuízo das medidas legais cabíveis.',
      },
    ],
  },
  {
    id: 'propriedade-intelectual',
    title: 'Propriedade intelectual',
    blocks: [
      {
        kind: 'paragraph',
        text: 'A plataforma, sua interface, seu código-fonte, sua marca e seus materiais pertencem aos autores do projeto e às instituições envolvidas. O acesso concedido a você é uma licença de uso pessoal, limitada, não exclusiva e revogável, restrita às finalidades previstas nestes termos.',
      },
      {
        kind: 'paragraph',
        text: 'Os arquivos e os dados de pesquisa que você utiliza continuam sendo seus. Ao divulgar resultados obtidos com apoio da ferramenta em trabalhos acadêmicos, pedimos que o InfraJoint seja devidamente citado.',
      },
      {
        kind: 'paragraph',
        text: 'Carregar arquivos na plataforma não nos concede licença sobre eles além do necessário para armazená-los e devolvê-los a você. Não utilizamos as imagens, os arquivos de temperatura e os dados clínicos para treinar modelos de inteligência artificial, não os cedemos a terceiros e não os empregamos em finalidade diversa da que motivou o registro, conforme detalhado na Política de Privacidade.',
      },
    ],
  },
  {
    id: 'disponibilidade',
    title: 'Disponibilidade do serviço',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Por se tratar de um projeto acadêmico, a plataforma é disponibilizada no estado em que se encontra, sem garantia de disponibilidade contínua, de ausência de falhas ou de precisão absoluta dos resultados.',
      },
      {
        kind: 'paragraph',
        text: 'Podemos alterar, suspender ou encerrar recursos, ou a própria plataforma, a qualquer momento, buscando comunicar previamente mudanças relevantes pelos canais disponíveis.',
      },
      {
        kind: 'paragraph',
        text: 'As análises são processadas no seu navegador e não são armazenadas pela plataforma: exporte os resultados que precisar preservar antes de encerrar a sessão.',
      },
    ],
  },
  {
    id: 'limitacao-de-responsabilidade',
    title: 'Limitação de responsabilidade',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Na máxima extensão permitida pela legislação aplicável, os autores e as instituições envolvidas no projeto não respondem por decisões clínicas, perdas de dados, lucros cessantes ou danos indiretos decorrentes do uso ou da indisponibilidade da plataforma.',
      },
      {
        kind: 'paragraph',
        text: 'Esta limitação não afasta os direitos assegurados por normas de ordem pública nem exclui a responsabilidade por dolo.',
      },
    ],
  },
  {
    id: 'encerramento',
    title: 'Encerramento da conta',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Você pode solicitar o encerramento da sua conta a qualquer momento pelo canal de contato. Podemos encerrar ou suspender contas que descumpram estes termos ou que representem risco à segurança da plataforma.',
      },
      {
        kind: 'paragraph',
        text: 'Encerrada a conta, os dados são tratados conforme descrito na Política de Privacidade.',
      },
    ],
  },
  {
    id: 'privacidade',
    title: 'Privacidade',
    blocks: [
      {
        kind: 'paragraph',
        text: 'O tratamento de dados pessoais é descrito na Política de Privacidade, disponível no rodapé da plataforma, que integra estes Termos de Uso para todos os efeitos.',
      },
    ],
  },
  {
    id: 'alteracoes',
    title: 'Alterações destes termos',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Estes termos podem ser atualizados para acompanhar a evolução da plataforma ou mudanças na legislação. A data da última atualização é sempre exibida no início da página, e o uso continuado após a publicação de uma nova versão significa concordância com ela.',
      },
    ],
  },
  {
    id: 'legislacao-aplicavel',
    title: 'Legislação aplicável',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Estes termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca de Niterói, estado do Rio de Janeiro, para dirimir eventuais controvérsias, com renúncia a qualquer outro, por mais privilegiado que seja.',
      },
    ],
  },
  {
    id: 'contato',
    title: 'Contato',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Dúvidas sobre estes Termos de Uso podem ser encaminhadas à equipe responsável pelo InfraJoint:',
      },
      {
        kind: 'contact',
        label: 'Equipe do projeto',
        email: LEGAL_CONTACT_EMAIL,
      },
    ],
  },
];
